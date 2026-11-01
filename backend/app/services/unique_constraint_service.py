"""Unique-constraint checks: configurable "no duplicate value(s) for this
column combination" rules on a template, shared by record create/update,
bulk import, and template-save-time conflict detection.

A constraint column holding a blank value never conflicts with anything --
same NULL-never-equals-NULL semantics as a SQL unique index -- so an
incomplete row never blocks another incomplete row.
"""

from collections.abc import Iterable
from typing import Any

from app.models.template import UniqueConstraint


def _constraint_key(data: dict[str, Any], columns: list[str]) -> tuple[Any, ...] | None:
    values = tuple(data.get(c) for c in columns)
    if any(v is None for v in values):
        return None
    return values


def find_conflict(
    constraints: list[UniqueConstraint],
    data: dict[str, Any],
    others: Iterable[dict[str, Any]],
) -> UniqueConstraint | None:
    """The first constraint `data` violates against any record in `others`
    (the caller excludes the record being updated from `others`, if any),
    or None."""
    others = list(others)
    for constraint in constraints:
        key = _constraint_key(data, constraint.columns)
        if key is None:
            continue
        if any(_constraint_key(other, constraint.columns) == key for other in others):
            return constraint
    return None


def conflicting_constraints(
    constraints: list[UniqueConstraint], records_data: list[dict[str, Any]]
) -> list[tuple[UniqueConstraint, int]]:
    """Template-save-time check: which configured constraints the given
    records already violate among themselves (e.g. existing data clashing
    with a newly added constraint), and how many records are affected --
    for surfacing as a destructive-change warning, not for enforcement."""
    results: list[tuple[UniqueConstraint, int]] = []
    for constraint in constraints:
        seen: set[tuple[Any, ...]] = set()
        affected = 0
        for data in records_data:
            key = _constraint_key(data, constraint.columns)
            if key is None:
                continue
            if key in seen:
                affected += 1
            else:
                seen.add(key)
        if affected:
            results.append((constraint, affected))
    return results


def conflict_message(constraint: UniqueConstraint) -> str:
    return (
        f"Duplicate value for unique constraint '{constraint.name}' "
        f"(columns: {', '.join(constraint.columns)})"
    )
