"""Record service: business logic on top of `records_repo`.

Adds computed formula columns (evaluated from the record's template) and
substring search over a record's `data`.
"""

import sqlite3
from typing import Any

from app.models.record import RecordRaw, RecordRead
from app.models.template import TemplateColumn, TemplateRead
from app.repository import records_repo, templates_repo
from app.services import unique_constraint_service
from app.services.formula_service import FormulaError, evaluate_formula


def _compute(columns: list[TemplateColumn], data: dict) -> dict[str, Any]:
    computed: dict[str, Any] = {}
    for column in columns:
        if column.formula is None:
            continue
        try:
            computed[column.name] = evaluate_formula(column.formula, data)
        except FormulaError:
            computed[column.name] = "#VALUE!"
    return computed


def _template_columns(
    conn: sqlite3.Connection, template_id: int
) -> list[TemplateColumn]:
    template = templates_repo.get_template(conn, template_id)
    return template.columns if template else []


def _raise_if_conflicts(
    template: TemplateRead | None, data: dict, others: list[dict]
) -> None:
    if not template or not template.unique_constraints:
        return
    conflict = unique_constraint_service.find_conflict(template.unique_constraints, data, others)
    if conflict:
        raise ValueError(unique_constraint_service.conflict_message(conflict))


def _to_read(record: RecordRaw, columns: list[TemplateColumn]) -> RecordRead:
    return RecordRead(
        id=record.id,
        template_id=record.template_id,
        data=record.data,
        computed=_compute(columns, record.data),
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def create_record(conn: sqlite3.Connection, template_id: int, data: dict) -> RecordRead:
    template = templates_repo.get_template(conn, template_id)
    if template and template.unique_constraints:
        others = [r.data for r in records_repo.list_records(conn, template_id)]
        _raise_if_conflicts(template, data, others)
    record = records_repo.create_record(conn, template_id, data)
    return _to_read(record, template.columns if template else [])


def get_record(conn: sqlite3.Connection, record_id: int) -> RecordRead:
    record = records_repo.get_record(conn, record_id)
    if record is None:
        raise LookupError(f"record {record_id} not found")
    return _to_read(record, _template_columns(conn, record.template_id))


def _matches_search(data: dict, search: str) -> bool:
    needle = search.lower()
    return any(needle in str(value).lower() for value in data.values())


def list_records(
    conn: sqlite3.Connection, template_id: int, search: str | None = None
) -> list[RecordRead]:
    records = records_repo.list_records(conn, template_id)
    if search:
        records = [r for r in records if _matches_search(r.data, search)]
    columns = _template_columns(conn, template_id)
    return [_to_read(record, columns) for record in records]


def update_record(conn: sqlite3.Connection, record_id: int, data: dict) -> RecordRead:
    existing = records_repo.get_record(conn, record_id)
    if existing is None:
        raise LookupError(f"record {record_id} not found")
    template = templates_repo.get_template(conn, existing.template_id)
    if template and template.unique_constraints:
        others = [
            r.data
            for r in records_repo.list_records(conn, existing.template_id)
            if r.id != record_id
        ]
        _raise_if_conflicts(template, data, others)
    record = records_repo.update_record(conn, record_id, data)
    return _to_read(record, template.columns if template else [])


def delete_record(conn: sqlite3.Connection, record_id: int) -> None:
    if records_repo.get_record(conn, record_id) is None:
        raise LookupError(f"record {record_id} not found")
    records_repo.delete_record(conn, record_id)
