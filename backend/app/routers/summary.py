import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query

from app.db import get_db
from app.models.summary import SummaryRow, SummaryViewCreate, SummaryViewRead
from app.repository import summary_views_repo
from app.services import record_service, summary_service, template_service

router = APIRouter(tags=["summary"])


@router.get("/templates/{template_id}/summary", response_model=list[SummaryRow])
def get_summary(
    template_id: int,
    group_by: list[str] = Query(...),
    metric: str | None = None,
    conn: sqlite3.Connection = Depends(get_db),
) -> list[SummaryRow]:
    template = template_service.get_template(conn, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    column_names = {column.name for column in template.columns}
    missing = [g for g in group_by if g not in column_names]
    if missing:
        raise HTTPException(
            status_code=422, detail=f"group_by {missing} is not a column"
        )
    records = record_service.list_records(conn, template_id)
    return summary_service.compute_summary(records, group_by, metric)


@router.get("/templates/{template_id}/summary-views", response_model=list[SummaryViewRead])
def list_summary_views(
    template_id: int, conn: sqlite3.Connection = Depends(get_db)
) -> list[SummaryViewRead]:
    template = template_service.get_template(conn, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return summary_views_repo.list_views(conn, template_id)


@router.post("/templates/{template_id}/summary-views", response_model=SummaryViewRead)
def create_summary_view(
    template_id: int, view: SummaryViewCreate, conn: sqlite3.Connection = Depends(get_db)
) -> SummaryViewRead:
    template = template_service.get_template(conn, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    column_names = {column.name for column in template.columns}
    missing = [g for g in view.group_by if g not in column_names]
    if missing:
        raise HTTPException(
            status_code=422, detail=f"group_by {missing} is not a column"
        )
    return summary_views_repo.create_view(conn, template_id, view)


@router.delete("/summary-views/{view_id}", status_code=204)
def delete_summary_view(view_id: int, conn: sqlite3.Connection = Depends(get_db)) -> None:
    if summary_views_repo.get_view(conn, view_id) is None:
        raise HTTPException(status_code=404, detail="Summary view not found")
    summary_views_repo.delete_view(conn, view_id)
