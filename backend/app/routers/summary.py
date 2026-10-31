import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from app.db import get_db
from app.models.summary import SummaryRow
from app.services import record_service, summary_service, template_service

router = APIRouter(tags=["summary"])


@router.get("/templates/{template_id}/summary", response_model=list[SummaryRow])
def get_summary(
    template_id: int,
    group_by: str,
    metric: str | None = None,
    conn: sqlite3.Connection = Depends(get_db),
) -> list[SummaryRow]:
    template = template_service.get_template(conn, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")
    column_names = {column.name for column in template.columns}
    if group_by not in column_names:
        raise HTTPException(
            status_code=422, detail=f"group_by '{group_by}' is not a column"
        )
    records = record_service.list_records(conn, template_id)
    return summary_service.compute_summary(records, group_by, metric)
