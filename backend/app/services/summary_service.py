"""Summary service: group records by one or more columns and sum an optional
metric.

A column's value is read from a record's `data` first, then from its
`computed` values.
"""

import json
from typing import Any

from app.models.record import RecordRead
from app.models.summary import SummaryRow


def _value(record: RecordRead, column: str) -> Any:
    if column in record.data:
        return record.data[column]
    return record.computed.get(column)


def _is_number(value: Any) -> bool:
    # bool is a subclass of int in Python, but a True/False cell is not a number.
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _group_key(value: Any) -> Any:
    # Lists and dicts can appear in `data` but cannot be dict keys. Group them
    # by a canonical JSON string so they never raise TypeError.
    try:
        hash(value)
    except TypeError:
        return json.dumps(value, sort_keys=True, default=str)
    return value


def compute_summary(
    records: list[RecordRead], group_by: list[str], metric: str | None = None
) -> list[SummaryRow]:
    groups: dict[tuple[Any, ...], list[RecordRead]] = {}
    for record in records:
        key = tuple(_group_key(_value(record, column)) for column in group_by)
        groups.setdefault(key, []).append(record)

    rows: list[SummaryRow] = []
    for key, members in groups.items():
        total: float | None = None
        if metric is not None:
            total = float(
                sum(v for v in (_value(r, metric) for r in members) if _is_number(v))
            )
        group_values = dict(zip(group_by, key, strict=True))
        rows.append(SummaryRow(group_values=group_values, count=len(members), sum=total))
    return rows
