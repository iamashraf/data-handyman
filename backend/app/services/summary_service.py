"""Summary service: group records by one column and sum an optional metric.

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
    records: list[RecordRead], group_by: str, metric: str | None = None
) -> list[SummaryRow]:
    groups: dict[Any, list[RecordRead]] = {}
    for record in records:
        key = _group_key(_value(record, group_by))
        groups.setdefault(key, []).append(record)

    rows: list[SummaryRow] = []
    for group_value, members in groups.items():
        total: float | None = None
        if metric is not None:
            total = float(
                sum(v for v in (_value(r, metric) for r in members) if _is_number(v))
            )
        rows.append(SummaryRow(group_value=group_value, count=len(members), sum=total))
    return rows
