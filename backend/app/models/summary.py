from typing import Any

from pydantic import BaseModel


class SummaryRow(BaseModel):
    group_value: Any
    count: int
    sum: float | None
