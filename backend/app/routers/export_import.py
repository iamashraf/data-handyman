import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Response

from app.db import get_db
from app.services import export_service, record_service, template_service

router = APIRouter(tags=["export"])

XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/templates/{template_id}/export")
def export_template(
    template_id: int,
    include_summary: bool = False,
    group_by: str | None = None,
    metric: str | None = None,
    conn: sqlite3.Connection = Depends(get_db),
) -> Response:
    template = template_service.get_template(conn, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")

    records = record_service.list_records(conn, template_id)
    try:
        file_bytes = export_service.export_template_to_xlsx(
            template,
            records,
            include_summary=include_summary,
            group_by=group_by,
            metric=metric,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return Response(
        content=file_bytes,
        media_type=XLSX_CONTENT_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{template.name}.xlsx"'},
    )
