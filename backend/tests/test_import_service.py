"""Import service: reading rows from an uploaded .xlsx workbook, and the
error-trace path for when that doesn't go cleanly (see also
test_api_export_import.py for the HTTP-level safety net)."""

import io
import logging

import openpyxl
import pytest

from app.models.template import TemplateColumn, TemplateRead
from app.repository import records_repo
from app.services.import_service import import_xlsx


def _template(columns: list[TemplateColumn]) -> TemplateRead:
    return TemplateRead(id=7, name="T", columns=columns, created_at="", updated_at="")


def _xlsx_bytes(header: list[str], rows: list[list]) -> bytes:
    wb = openpyxl.Workbook()
    sheet = wb.active
    sheet.append(header)
    for row in rows:
        sheet.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_valid_rows_import_and_log_a_summary(db_conn, caplog):
    template = _template([TemplateColumn(name="amount", type="number", formula=None)])
    file_bytes = _xlsx_bytes(["amount"], [[1], [2]])

    with caplog.at_level(logging.INFO, logger="app.import_service"):
        result = import_xlsx(db_conn, template, file_bytes)

    assert result.imported_count == 2
    assert result.errors == []
    assert any("2 row(s) imported, 0 failed" in r.message for r in caplog.records)


def test_unreadable_workbook_logs_a_warning(db_conn, caplog):
    template = _template([TemplateColumn(name="amount", type="number", formula=None)])

    with caplog.at_level(logging.WARNING, logger="app.import_service"), pytest.raises(ValueError):
        import_xlsx(db_conn, template, b"not an xlsx file")

    assert any("isn't a readable .xlsx workbook" in r.message for r in caplog.records)


def test_header_mismatch_logs_a_warning_and_returns_cleanly(db_conn, caplog):
    template = _template([TemplateColumn(name="amount", type="number", formula=None)])
    file_bytes = _xlsx_bytes(["wrong_column"], [[1]])

    with caplog.at_level(logging.WARNING, logger="app.import_service"):
        result = import_xlsx(db_conn, template, file_bytes)

    assert result.imported_count == 0
    assert result.errors[0].row_number == 0
    assert any("header mismatch" in r.message.lower() for r in caplog.records)


def test_unexpected_row_failure_is_logged_reported_and_does_not_abort_the_rest(
    db_conn, caplog, monkeypatch
):
    """A row that merely fails validation (a bad cell) is a normal, expected
    outcome -- already covered by the header/coercion behavior. This is the
    *unexpected* case: something throws while actually saving a row (e.g. a
    database error). That shouldn't take down rows before or after it, and
    it needs to leave a trace, since there's no good user-facing
    explanation for it the way there is for a validation error."""
    template = _template([TemplateColumn(name="amount", type="number", formula=None)])
    file_bytes = _xlsx_bytes(["amount"], [[1], [2], [3]])

    original_create_record = records_repo.create_record

    def flaky_create_record(conn, template_id, data):
        if data["amount"] == 2:
            raise RuntimeError("simulated database failure")
        return original_create_record(conn, template_id, data)

    monkeypatch.setattr(records_repo, "create_record", flaky_create_record)

    with caplog.at_level(logging.ERROR, logger="app.import_service"):
        result = import_xlsx(db_conn, template, file_bytes)

    # Rows 1 and 3 (amount 1 and 3) still made it in despite row 2 blowing up.
    assert result.imported_count == 2
    assert len(result.errors) == 1
    assert result.errors[0].row_number == 3  # header is row 1, so amount=2 is row 3
    assert "unexpected error" in result.errors[0].reason.lower()
    assert any("failed to save unexpectedly" in r.message for r in caplog.records)
    assert any(r.exc_info for r in caplog.records)  # full traceback was captured
