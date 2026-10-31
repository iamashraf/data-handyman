import sqlite3
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Response

from app.db import get_db
from app.services import export_service, record_service, template_service

router = APIRouter(tags=["export"])

XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


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
