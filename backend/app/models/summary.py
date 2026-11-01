from typing import Any, Literal

from pydantic import BaseModel

ChartType = Literal["bar", "line", "pie", "area"]


class SummaryRow(BaseModel):
    # One entry per group_by column, e.g. {"region": "West", "status": "Open"}
    # for a two-column grouping -- always present, even for a single-column
    # group_by, so callers never need to special-case the compound case.
    group_values: dict[str, Any]
    count: int
    sum: float | None


class SummaryViewCreate(BaseModel):
    name: str
    group_by: list[str]
    metric: str | None = None
    chart_type: ChartType = "bar"


class SummaryViewRead(BaseModel):
    id: int
    template_id: int
    name: str
    group_by: list[str]
    metric: str | None
    chart_type: ChartType
    created_at: str
    updated_at: str
