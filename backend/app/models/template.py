from typing import Literal

from pydantic import BaseModel


class TemplateColumn(BaseModel):
    name: str
    type: Literal["text", "number", "date", "boolean"]
    formula: str | None = None
    # Optional display settings (UI only -- the backend never interprets
    # these). All default to None so existing templates, saved before
    # these fields existed, keep working with no migration: a missing
    # field just falls back to the frontend's own default.
    label: str | None = None
    format: Literal["plain", "integer", "currency", "percent", "choice"] | None = None
    decimals: int | None = None
    currency: str | None = None
    options: list[str] | None = None
    style: Literal["check", "alert"] | None = None
    width: int | None = None
    pinned: Literal["left"] | None = None


class TemplateRead(BaseModel):
    id: int
    name: str
    columns: list[TemplateColumn]
    created_at: str
    updated_at: str
