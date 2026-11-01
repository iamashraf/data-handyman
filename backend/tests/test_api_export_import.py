import io
import logging

import openpyxl

from app.services import import_service


def _template_with_records(client):
    t = client.post(
        "/templates",
        json={
            "name": "T",
            "columns": [
                {"name": "status", "type": "text", "formula": None},
                {"name": "amount", "type": "number", "formula": None},
            ],
        },
    ).json()
    rows = [
        {"status": "Open", "amount": 2},
        {"status": "Closed", "amount": 5},
    ]
    for data in rows:
        client.post(f"/templates/{t['id']}/records", json={"data": data})
    return t["id"]


def test_export_endpoint_returns_xlsx(client):
    t = client.post(
        "/templates",
        json={
            "name": "T",
            "columns": [{"name": "status", "type": "text", "formula": None}],
        },
    ).json()
    resp = client.get(f"/templates/{t['id']}/export")
    assert resp.status_code == 200
    assert (
        resp.headers["content-type"]
        == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


def test_export_endpoint_content_disposition_uses_template_name(client):
    t = client.post(
        "/templates",
        json={
            "name": "My Template",
            "columns": [{"name": "status", "type": "text", "formula": None}],
        },
    ).json()
    resp = client.get(f"/templates/{t['id']}/export")
    assert resp.status_code == 200
    assert (
        resp.headers["content-disposition"] == 'attachment; filename="My Template.xlsx"'
    )


def test_export_endpoint_with_records(client):
    template_id = _template_with_records(client)
    resp = client.get(f"/templates/{template_id}/export")
    assert resp.status_code == 200
    assert len(resp.content) > 0


def test_export_endpoint_include_summary_requires_group_by(client):
    t = client.post(
        "/templates",
        json={
            "name": "T",
            "columns": [{"name": "status", "type": "text", "formula": None}],
        },
    ).json()
    resp = client.get(f"/templates/{t['id']}/export", params={"include_summary": True})
    assert resp.status_code == 422


def test_export_endpoint_include_summary_with_group_by(client):
    template_id = _template_with_records(client)
    resp = client.get(
        f"/templates/{template_id}/export",
        params={"include_summary": True, "group_by": "status", "metric": "amount"},
    )
    assert resp.status_code == 200
    assert (
        resp.headers["content-type"]
        == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


def test_export_endpoint_include_summary_with_multiple_group_by_columns(client):
    template_id = _template_with_records(client)
    resp = client.get(
        f"/templates/{template_id}/export",
        params=[
            ("include_summary", True),
            ("group_by", "status"),
            ("group_by", "amount"),
            ("metric", "amount"),
        ],
    )
    assert resp.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(resp.content))
    data_sheet = wb["Data"]
    summary_col = 2 + 2  # two data columns + 2
    assert [
        data_sheet.cell(row=2, column=summary_col + i).value for i in range(4)
    ] == ["status", "amount", "count", "sum"]


def test_export_endpoint_with_ids_only_includes_those_records(client):
    template_id = _template_with_records(client)
    all_records = client.get(f"/templates/{template_id}/records").json()
    assert len(all_records) == 2
    # Keep the "Closed"/5 record specifically, so the assertion below can't
    # pass by coincidence (e.g. a bug that just kept the first N records).
    keep = next(r for r in all_records if r["data"]["status"] == "Closed")

    resp = client.get(
        f"/templates/{template_id}/export", params={"ids": keep["id"]}
    )
    assert resp.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(resp.content))
    sheet = wb.active
    assert sheet.max_row == 2  # header + the one kept record
    assert [c.value for c in sheet[2]] == ["Closed", 5]


def test_export_endpoint_without_ids_exports_everything(client):
    template_id = _template_with_records(client)
    resp = client.get(f"/templates/{template_id}/export")
    assert resp.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(resp.content))
    sheet = wb.active
    assert sheet.max_row == 3  # header + both records


def test_export_endpoint_with_columns_only_includes_those_columns(client):
    template_id = _template_with_records(client)
    resp = client.get(
        f"/templates/{template_id}/export", params={"columns": "status"}
    )
    assert resp.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(resp.content))
    sheet = wb.active
    assert [c.value for c in sheet[1]] == ["status"]
    assert [c.value for c in sheet[2]] == ["Open"]


def test_export_endpoint_columns_keeps_template_order_not_query_order(client):
    template_id = _template_with_records(client)
    resp = client.get(
        f"/templates/{template_id}/export",
        params=[("columns", "amount"), ("columns", "status")],
    )
    assert resp.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(resp.content))
    sheet = wb.active
    # Template defines status before amount -- the export keeps that order
    # even though the query params list amount first.
    assert [c.value for c in sheet[1]] == ["status", "amount"]


def test_export_endpoint_without_columns_exports_everything(client):
    template_id = _template_with_records(client)
    resp = client.get(f"/templates/{template_id}/export")
    assert resp.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(resp.content))
    sheet = wb.active
    assert [c.value for c in sheet[1]] == ["status", "amount"]


def test_export_endpoint_404_when_template_missing(client):
    resp = client.get("/templates/999/export")
    assert resp.status_code == 404


def test_export_endpoint_200_for_record_with_list_value(client):
    t = client.post(
        "/templates",
        json={
            "name": "T",
            "columns": [{"name": "tags", "type": "text", "formula": None}],
        },
    ).json()
    client.post(f"/templates/{t['id']}/records", json={"data": {"tags": ["a"]}})
    resp = client.get(f"/templates/{t['id']}/export")
    assert resp.status_code == 200


def _xlsx_upload(header, rows):
    wb = openpyxl.Workbook()
    sheet = wb.active
    sheet.append(header)
    for row in rows:
        sheet.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return ("data.xlsx", buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


def test_import_endpoint_imports_valid_rows(client):
    t = client.post(
        "/templates",
        json={"name": "T", "columns": [{"name": "amount", "type": "number", "formula": None}]},
    ).json()
    resp = client.post(
        f"/templates/{t['id']}/import",
        files={"file": _xlsx_upload(["amount"], [[1], [2]])},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["imported_count"] == 2
    assert body["errors"] == []


def test_import_endpoint_reports_header_mismatch_as_a_row_0_error(client):
    # Not a 422 -- a header mismatch is part of the normal partial-success
    # ImportResult shape (row_number 0), same as any other row error; the
    # frontend tells it apart from a per-row error by that row number.
    t = client.post(
        "/templates",
        json={"name": "T", "columns": [{"name": "amount", "type": "number", "formula": None}]},
    ).json()
    resp = client.post(
        f"/templates/{t['id']}/import",
        files={"file": _xlsx_upload(["wrong_column"], [[1]])},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["imported_count"] == 0
    assert body["errors"][0]["row_number"] == 0
    assert "header mismatch" in body["errors"][0]["reason"].lower()


def test_import_endpoint_logs_and_returns_500_for_an_unexpected_failure(client, caplog, monkeypatch):
    """A genuinely unexpected failure (not a validation problem) should
    still be traceable from the server log, not just a bare 500 with no
    explanation anywhere."""
    t = client.post(
        "/templates",
        json={"name": "T", "columns": [{"name": "amount", "type": "number", "formula": None}]},
    ).json()

    def boom(conn, template, file_bytes):
        raise RuntimeError("simulated failure reading the workbook")

    monkeypatch.setattr(import_service, "import_xlsx", boom)

    with caplog.at_level(logging.ERROR, logger="app.export_import"):
        resp = client.post(
            f"/templates/{t['id']}/import",
            files={"file": _xlsx_upload(["amount"], [[1]])},
        )

    assert resp.status_code == 500
    assert "check the server log" in resp.json()["detail"].lower()
    assert any("import failed unexpectedly" in r.message.lower() for r in caplog.records)
    assert any(r.exc_info for r in caplog.records)
