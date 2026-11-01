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
    format: Literal["plain", "integer", "currency", "percent", "choice", "long_text"] | None = None
    decimals: int | None = None
    currency: str | None = None
    options: list[str] | None = None
    style: Literal["check", "alert"] | None = None
    width: int | None = None
    pinned: Literal["left"] | None = None


class UniqueConstraint(BaseModel):
    """A "no two records share this value" rule over one or more of a
    template's plain (non-formula) columns. A record where any of the
    constraint's columns is blank never conflicts with anything -- same
    NULL-never-equals-NULL semantics as a SQL unique index."""

    name: str
    columns: list[str]


class TemplateRead(BaseModel):
    id: int
    name: str
    columns: list[TemplateColumn]
    unique_constraints: list[UniqueConstraint] = []
    created_at: str
    updated_at: str
