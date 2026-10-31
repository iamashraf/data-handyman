from typing import Literal

from pydantic import BaseModel


class TemplateColumn(BaseModel):
    name: str
    type: Literal["text", "number", "date", "boolean"]
    formula: str | None = None


class TemplateRead(BaseModel):
    id: int
    name: str
    columns: list[TemplateColumn]
    created_at: str
    updated_at: str
