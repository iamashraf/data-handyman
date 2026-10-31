import sqlite3
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db import get_db
from app.models.record import RecordRead
from app.services import record_service

router = APIRouter(tags=["records"])


class RecordCreateRequest(BaseModel):
    data: dict[str, Any]


class RecordUpdateRequest(BaseModel):
    data: dict[str, Any]


@router.post(
    "/templates/{template_id}/records", status_code=201, response_model=RecordRead
)
def create_record(
    template_id: int,
    payload: RecordCreateRequest,
    conn: sqlite3.Connection = Depends(get_db),
) -> RecordRead:
    return record_service.create_record(conn, template_id, payload.data)


@router.get("/templates/{template_id}/records", response_model=list[RecordRead])
def list_records(
    template_id: int,
    search: str | None = None,
    conn: sqlite3.Connection = Depends(get_db),
) -> list[RecordRead]:
    return record_service.list_records(conn, template_id, search=search)


@router.get("/records/{record_id}", response_model=RecordRead)
def get_record(
    record_id: int, conn: sqlite3.Connection = Depends(get_db)
) -> RecordRead:
    try:
        return record_service.get_record(conn, record_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Record not found") from exc


@router.put("/records/{record_id}", response_model=RecordRead)
def update_record(
    record_id: int,
    payload: RecordUpdateRequest,
    conn: sqlite3.Connection = Depends(get_db),
) -> RecordRead:
    try:
        return record_service.update_record(conn, record_id, payload.data)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Record not found") from exc


@router.delete("/records/{record_id}", status_code=204)
def delete_record(record_id: int, conn: sqlite3.Connection = Depends(get_db)) -> None:
    try:
        record_service.delete_record(conn, record_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Record not found") from exc
