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
