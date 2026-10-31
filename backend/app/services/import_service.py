"""Import service: read records from an uploaded .xlsx workbook.

Reads the first sheet. The header row must match the template's
*non-formula* column names exactly (order-independent) -- formula columns
are computed, not imported, so they're never expected in the file. On a
header mismatch, nothing is imported and a single row-0 error is reported.

Otherwise each data row is validated independently: a row with any
invalid cell is skipped and reported in `errors` (with its 1-based
spreadsheet row number, header counted as row 1), while valid rows are
inserted via `records_repo.create_record`. This is a partial-success
model -- one bad row never blocks the rest of the file.
"""

import io
import math
import sqlite3
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException

from app.models.template import TemplateColumn, TemplateRead
from app.repository import records_repo


@dataclass
class ImportRowError:
    row_number: int
    reason: str


@dataclass
class ImportResult:
    imported_count: int
    errors: list[ImportRowError] = field(default_factory=list)


def _coerce_text(value: Any) -> tuple[bool, Any]:
    return True, value if isinstance(value, str) else str(value)


def _coerce_number(value: Any) -> tuple[bool, Any]:
    if isinstance(value, bool):
        return False, None
    if isinstance(value, (int, float)):
        return (True, value) if math.isfinite(value) else (False, None)
    if isinstance(value, str):
        try:
            parsed = float(value.strip())
        except ValueError:
            return False, None
        return (True, parsed) if math.isfinite(parsed) else (False, None)
    return False, None


def _coerce_boolean(value: Any) -> tuple[bool, Any]:
    if isinstance(value, bool):
        return True, value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered == "true":
            return True, True
        if lowered == "false":
            return True, False
    return False, None


def _coerce_date(value: Any) -> tuple[bool, Any]:
    if isinstance(value, datetime):
        return True, value.date().isoformat()
    if isinstance(value, date):
        return True, value.isoformat()
    if isinstance(value, str):
        try:
            parsed = date.fromisoformat(value.strip())
        except ValueError:
            return False, None
        return True, parsed.isoformat()
    return False, None


_COERCERS = {
    "text": _coerce_text,
    "number": _coerce_number,
    "boolean": _coerce_boolean,
    "date": _coerce_date,
}


def _coerce_cell(value: Any, column_type: str) -> tuple[bool, Any]:
    """Validate+coerce one cell against its column's declared type.

    A blank cell (`None`) is always valid -- the rest of the app already
    treats a missing value as legitimate (e.g. formula substitution
    renders `None` as an empty string), so import doesn't newly require
    every typed cell to be filled in.
    """
    if value is None:
        return True, None
    return _COERCERS[column_type](value)


def _header_names(row: tuple) -> list[str]:
    # iter_rows pads every row out to the sheet's max column, so a stray
    # styled cell past the real header would otherwise show up as a
    # trailing blank "column". Strip trailing blanks before comparing.
    names = [cell if isinstance(cell, str) else str(cell) for cell in row]
    while names and names[-1] == "None":
        names.pop()
    return names


def import_xlsx(
    conn: sqlite3.Connection, template: TemplateRead, file_bytes: bytes
) -> ImportResult:
    expected_columns: list[TemplateColumn] = [
        c for c in template.columns if c.formula is None
    ]
    expected_names = [c.name for c in expected_columns]

    try:
        workbook = load_workbook(io.BytesIO(file_bytes), data_only=True)
    except (zipfile.BadZipFile, InvalidFileException) as exc:
        raise ValueError("Could not read uploaded file as an .xlsx workbook") from exc

    sheet = workbook.worksheets[0]
    rows = list(sheet.iter_rows(values_only=True))

    header = _header_names(rows[0]) if rows else []
    if sorted(header) != sorted(expected_names):
        return ImportResult(
            imported_count=0,
            errors=[
                ImportRowError(
                    row_number=0,
                    reason=(
                        "Header mismatch: expected columns "
                        f"{sorted(expected_names)}, found {sorted(header)}"
                    ),
                )
            ],
        )

    imported_count = 0
    errors: list[ImportRowError] = []

    for row_number, row in enumerate(rows[1:], start=2):
        if all(cell is None for cell in row):
            continue  # trailing/blank row from the sheet's styled range

        row_by_name = dict(zip(header, row))
        data: dict[str, Any] = {}
        row_reasons: list[str] = []

        for column in expected_columns:
            ok, coerced = _coerce_cell(row_by_name.get(column.name), column.type)
            if not ok:
                row_reasons.append(
                    f"column '{column.name}': invalid value for type '{column.type}'"
                )
            else:
                data[column.name] = coerced

        if row_reasons:
            errors.append(
                ImportRowError(row_number=row_number, reason="; ".join(row_reasons))
            )
            continue

        records_repo.create_record(conn, template.id, data)
        imported_count += 1

    return ImportResult(imported_count=imported_count, errors=errors)
