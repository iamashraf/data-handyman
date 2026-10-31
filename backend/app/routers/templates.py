import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db import get_db
from app.models.template import TemplateColumn, TemplateRead
from app.services import template_service

router = APIRouter(prefix="/templates", tags=["templates"])


class TemplateCreateRequest(BaseModel):
    name: str
    columns: list[TemplateColumn]


class TemplateUpdateRequest(BaseModel):
    name: str
    columns: list[TemplateColumn]
    force: bool = False


class TemplateApplied(BaseModel):
    status: Literal["applied"] = "applied"
    template: TemplateRead


class TemplateWarning(BaseModel):
    status: Literal["warning"] = "warning"
    affected_record_count: int
    reasons: list[str]


@router.post("", status_code=201, response_model=TemplateRead)
def create_template(
    payload: TemplateCreateRequest, conn: sqlite3.Connection = Depends(get_db)
) -> TemplateRead:
    try:
        return template_service.create_template(conn, payload.name, payload.columns)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("", response_model=list[TemplateRead])
def list_templates(conn: sqlite3.Connection = Depends(get_db)) -> list[TemplateRead]:
    return template_service.list_templates(conn)


@router.get("/{template_id}", response_model=TemplateRead)
def get_template(
    template_id: int, conn: sqlite3.Connection = Depends(get_db)
) -> TemplateRead:
    template = template_service.get_template(conn, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@router.put("/{template_id}", response_model=TemplateApplied | TemplateWarning)
def update_template(
    template_id: int,
    payload: TemplateUpdateRequest,
    conn: sqlite3.Connection = Depends(get_db),
) -> TemplateApplied | TemplateWarning:
    try:
        result = template_service.update_template(
            conn, template_id, payload.name, payload.columns, force=payload.force
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Template not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if result.template is not None:
        return TemplateApplied(template=result.template)
    return TemplateWarning(
        affected_record_count=result.warning.affected_record_count,
        reasons=result.warning.reasons,
    )


@router.delete("/{template_id}", status_code=204)
def delete_template(
    template_id: int, conn: sqlite3.Connection = Depends(get_db)
) -> None:
    template = template_service.get_template(conn, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    template_service.delete_template(conn, template_id)
