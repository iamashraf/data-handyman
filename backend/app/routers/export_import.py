import logging
import sqlite3
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel

from app.db import get_db
from app.models.template import TemplateRead
from app.services import (
    export_service,
    import_service,
    record_service,
    template_service,
)

logger = logging.getLogger("app.export_import")

router = APIRouter(tags=["export"])

XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class ImportRowErrorResponse(BaseModel):
    row_number: int
    reason: str


class ImportResultResponse(BaseModel):
    imported_count: int
    errors: list[ImportRowErrorResponse]


class TemplateFromExcelResponse(BaseModel):
    template: TemplateRead
    import_result: ImportResultResponse


def _import_result_response(result: import_service.ImportResult) -> ImportResultResponse:
    return ImportResultResponse(
        imported_count=result.imported_count,
        errors=[
            ImportRowErrorResponse(row_number=e.row_number, reason=e.reason)
            for e in result.errors
        ],
    )


def _content_disposition(filename: str) -> str:
    """Build a Content-Disposition header that can't crash on the filename.

    `template.name` (and therefore the exported filename) has no character
    restriction, so it can contain:
    - `"` (breaks the quoted filename),
    - non-Latin-1 characters (raises UnicodeEncodeError when Starlette
      encodes the header as latin-1), or
    - control characters (ord < 32, or 127 -- e.g. `\\r`, `\\n`, `\\x00`,
      all valid in a JSON string) which a real server's header validation
      (h11, under uvicorn) rejects outright, unlike FastAPI's TestClient.

    The ASCII `filename=` fallback strips anything that can't be encoded,
    strips control characters, and drops quotes. If stripping leaves no
    real name (just the ".xlsx" extension, e.g. an all-non-ASCII name), it
    falls back to a generic "export.xlsx" instead of a bare ".xlsx". When
    the fallback differs from the original, the RFC 5987
    `filename*=UTF-8''<percent-encoded>` form is added alongside it so
    modern browsers still get the real name.
    """
    ascii_safe = "".join(
        ch
        for ch in filename.encode("ascii", "ignore").decode("ascii")
        if ord(ch) >= 32 and ord(ch) != 127
    ).replace('"', "'")
    stem, _, ext = ascii_safe.rpartition(".")
    if not stem.strip():
        ascii_safe = f"export.{ext}" if ext else "export.xlsx"
    if ascii_safe == filename:
        return f'attachment; filename="{ascii_safe}"'
    encoded = quote(filename, safe="")
    return f"attachment; filename=\"{ascii_safe}\"; filename*=UTF-8''{encoded}"


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
        headers={"Content-Disposition": _content_disposition(f"{template.name}.xlsx")},
    )


@router.post("/templates/{template_id}/import")
def import_template(
    template_id: int,
    file: Annotated[UploadFile, File()],
    conn: sqlite3.Connection = Depends(get_db),
) -> ImportResultResponse:
    template = template_service.get_template(conn, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")

    file_bytes = file.file.read()
    try:
        result = import_service.import_xlsx(conn, template, file_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        # Per-row failures are already handled inside import_xlsx; this is
        # a safety net for anything unexpected outside that loop (e.g. a
        # workbook openpyxl loads but then chokes on while reading rows).
        # Logged here, with request context, rather than left to whatever
        # the ASGI server's own unhandled-exception logging does.
        logger.exception(
            "Import failed unexpectedly for template %s, file %r", template_id, file.filename
        )
        raise HTTPException(
            status_code=500,
            detail="Couldn't import this file due to an unexpected error. Check the server log for details.",
        ) from exc

    return _import_result_response(result)


@router.post("/templates/from-excel")
def create_template_from_excel(
    name: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    conn: sqlite3.Connection = Depends(get_db),
) -> TemplateFromExcelResponse:
    """Create a new template by inferring its columns from an uploaded
    .xlsx file's header/data, then immediately import that same file's
    rows as the template's first records -- one combined action, no
    separate "review the inferred schema" step (the columns can always be
    edited afterward like any other template)."""
    file_bytes = file.file.read()
    try:
        columns = import_service.infer_template_columns(file_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        template = template_service.create_template(conn, name, columns)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        result = import_service.import_xlsx(conn, template, file_bytes)
    except Exception as exc:
        logger.exception(
            "Create-from-Excel: import failed unexpectedly for new template %s, file %r",
            template.id,
            file.filename,
        )
        raise HTTPException(
            status_code=500,
            detail="The template was created, but importing its rows failed unexpectedly. Check the server log for details.",
        ) from exc
    return TemplateFromExcelResponse(
        template=template, import_result=_import_result_response(result)
    )
