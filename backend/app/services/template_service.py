"""Template service: business logic on top of `templates_repo`.

Adds formula validation on create/update and destructive-change detection
on update (see `_destructive_change_reasons`).
"""

import sqlite3
from dataclasses import dataclass

from app.models.template import TemplateColumn, TemplateRead, UniqueConstraint
from app.repository import records_repo, summary_views_repo, templates_repo
from app.services import unique_constraint_service
from app.services.formula_service import validate_formula


@dataclass
class SchemaChangeWarning:
    affected_record_count: int
    reasons: list[str]


@dataclass
class TemplateUpdateResult:
    template: TemplateRead | None
    warning: SchemaChangeWarning | None


def _formula_errors(column: TemplateColumn, column_names: list[str]) -> list[str]:
    if column.formula is None:
        return []
    return validate_formula(column.formula, column_names)


def _raise_if_invalid(columns: list[TemplateColumn], column_names: list[str]) -> None:
    for col in columns:
        errors = _formula_errors(col, column_names)
        if errors:
            raise ValueError(
                f"Invalid formula for column '{col.name}': {'; '.join(errors)}"
            )


def _validate_constraints(
    unique_constraints: list[UniqueConstraint], columns: list[TemplateColumn]
) -> None:
    non_formula_names = {c.name for c in columns if c.formula is None}
    for constraint in unique_constraints:
        if not constraint.columns:
            raise ValueError(f"Unique constraint '{constraint.name}' needs at least one column")
        unknown = [col for col in constraint.columns if col not in non_formula_names]
        if unknown:
            raise ValueError(
                f"Unique constraint '{constraint.name}' references unknown or "
                f"formula column(s) {unknown} -- a constraint can only cover "
                "plain (non-formula) columns on this template"
            )


def _destructive_change_reasons(
    old_columns: list[TemplateColumn],
    new_columns: list[TemplateColumn],
    records: list,
    unedited_surviving_columns: list[TemplateColumn],
) -> tuple[list[str], int]:
    """Implements the destructive-change rule.

    (a) a column present in the old schema is absent from the new one AND at
        least one existing record has non-null data under that column name.
    (b) any *unedited surviving* column's formula (a column that existed
        before, kept the same name, and whose formula text wasn't touched in
        this request) fails `validate_formula` against the new column name
        list -- this catches removing column B invalidating column C's
        formula even though C itself wasn't edited. A column whose own
        formula *was* edited in this request is a plain authoring error
        instead (see `_raise_if_invalid` in `update_template`), not a
        destructive-change warning.
    """
    old_names = {c.name for c in old_columns}
    new_names = [c.name for c in new_columns]
    removed_names = old_names - set(new_names)

    reasons: list[str] = []
    affected_record_count = 0

    if removed_names:
        affected_record_count = sum(
            1
            for record in records
            if any(record.data.get(name) is not None for name in removed_names)
        )
        if affected_record_count:
            reasons.append(
                f"Removing column(s) {', '.join(sorted(removed_names))} discards "
                f"data in {affected_record_count} existing record(s)"
            )

    for col in unedited_surviving_columns:
        errors = _formula_errors(col, new_names)
        if errors:
            reasons.append(
                f"Column '{col.name}' formula is invalid after this change: "
                f"{'; '.join(errors)}"
            )

    return reasons, affected_record_count


def create_template(
    conn: sqlite3.Connection,
    name: str,
    columns: list[TemplateColumn],
    unique_constraints: list[UniqueConstraint] | None = None,
) -> TemplateRead:
    unique_constraints = unique_constraints or []
    _raise_if_invalid(columns, [c.name for c in columns])
    _validate_constraints(unique_constraints, columns)
    return templates_repo.create_template(conn, name, columns, unique_constraints)


def get_template(conn: sqlite3.Connection, template_id: int) -> TemplateRead | None:
    return templates_repo.get_template(conn, template_id)


def list_templates(conn: sqlite3.Connection) -> list[TemplateRead]:
    return templates_repo.list_templates(conn)


def delete_template(conn: sqlite3.Connection, template_id: int) -> None:
    # No FK/cascade at the schema level -- without this, a deleted
    # template's records (and saved summary views) become permanently
    # orphaned: invisible, but still occupying the database, and liable to
    # resurface attached to an unrelated template if sqlite later reuses
    # the freed id (ids aren't AUTOINCREMENT).
    records_repo.delete_records_by_template(conn, template_id)
    summary_views_repo.delete_views_by_template(conn, template_id)
    templates_repo.delete_template(conn, template_id)


def update_template(
    conn: sqlite3.Connection,
    template_id: int,
    name: str,
    columns: list[TemplateColumn],
    unique_constraints: list[UniqueConstraint] | None = None,
    force: bool = False,
) -> TemplateUpdateResult:
    unique_constraints = unique_constraints or []
    old = templates_repo.get_template(conn, template_id)
    if old is None:
        raise LookupError(f"template {template_id} not found")

    old_by_name = {c.name: c for c in old.columns}
    new_names = [c.name for c in columns]

    # A column that's brand new in this request, or whose formula text was
    # changed here, is validated immediately: that's a plain authoring
    # error, not a side effect of someone else's edit, so it raises
    # ValueError (-> 422) rather than becoming a destructive-change warning.
    edited_or_new_columns = [
        col
        for col in columns
        if old_by_name.get(col.name) is None
        or old_by_name[col.name].formula != col.formula
    ]
    _raise_if_invalid(edited_or_new_columns, new_names)
    _validate_constraints(unique_constraints, columns)

    unedited_surviving_columns = [
        col
        for col in columns
        if col.name in old_by_name and old_by_name[col.name].formula == col.formula
    ]

    records = records_repo.list_records(conn, template_id)
    reasons, affected_record_count = _destructive_change_reasons(
        old.columns, columns, records, unedited_surviving_columns
    )

    # A constraint being added or widened here can already be violated by
    # existing data -- that's not a plain authoring error (the constraint
    # itself is well-formed), so it joins the destructive-change warning
    # instead of raising, with the same force-to-save-anyway escape hatch.
    for constraint, affected in unique_constraint_service.conflicting_constraints(
        unique_constraints, [r.data for r in records]
    ):
        reasons.append(
            f"Unique constraint '{constraint.name}' ({', '.join(constraint.columns)}) "
            f"conflicts with {affected} existing record(s) that share the same value"
        )
        affected_record_count = max(affected_record_count, affected)

    if reasons and not force:
        return TemplateUpdateResult(
            template=None,
            warning=SchemaChangeWarning(
                affected_record_count=affected_record_count, reasons=reasons
            ),
        )

    updated = templates_repo.update_template(conn, template_id, name, columns, unique_constraints)
    return TemplateUpdateResult(template=updated, warning=None)
