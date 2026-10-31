from typing import Any

from pydantic import BaseModel


class RecordRaw(BaseModel):
    id: int
    template_id: int
    data: dict[str, Any]
    created_at: str
    updated_at: str


class RecordRead(BaseModel):
    id: int
    template_id: int
    data: dict[str, Any]
    computed: dict[str, Any]
    created_at: str
    updated_at: str
