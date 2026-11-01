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
        {"status": "Open", "amount": 3},
        {"status": "Closed", "amount": 5},
    ]
    for data in rows:
        client.post(f"/templates/{t['id']}/records", json={"data": data})
    return t["id"]


def test_summary_endpoint_groups_and_sums(client):
    template_id = _template_with_records(client)
    resp = client.get(
        f"/templates/{template_id}/summary",
        params={"group_by": "status", "metric": "amount"},
    )
    assert resp.status_code == 200
    by_group = {row["group_values"]["status"]: row for row in resp.json()}
    assert by_group["Open"] == {"group_values": {"status": "Open"}, "count": 2, "sum": 5.0}
    assert by_group["Closed"] == {"group_values": {"status": "Closed"}, "count": 1, "sum": 5.0}


def test_summary_endpoint_sum_is_null_without_metric(client):
    template_id = _template_with_records(client)
    resp = client.get(
        f"/templates/{template_id}/summary", params={"group_by": "status"}
    )
    assert resp.status_code == 200
    assert all(row["sum"] is None for row in resp.json())


def test_summary_endpoint_422_when_group_by_is_not_a_column(client):
    template_id = _template_with_records(client)
    resp = client.get(f"/templates/{template_id}/summary", params={"group_by": "nope"})
    assert resp.status_code == 422


def test_summary_endpoint_groups_unhashable_values_without_500(client):
    t = client.post(
        "/templates",
        json={
            "name": "T",
            "columns": [{"name": "tags", "type": "text", "formula": None}],
        },
    ).json()
    client.post(f"/templates/{t['id']}/records", json={"data": {"tags": ["a"]}})
    client.post(f"/templates/{t['id']}/records", json={"data": {"tags": ["a"]}})
    resp = client.get(f"/templates/{t['id']}/summary", params={"group_by": "tags"})
    assert resp.status_code == 200
    assert resp.json() == [{"group_values": {"tags": '["a"]'}, "count": 2, "sum": None}]


def test_summary_endpoint_404_when_template_missing(client):
    resp = client.get("/templates/999/summary", params={"group_by": "status"})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Template not found"


def test_create_summary_view_endpoint(client):
    template_id = _template_with_records(client)
    resp = client.post(
        f"/templates/{template_id}/summary-views",
        json={"name": "By status", "group_by": ["status"], "metric": "amount", "chart_type": "line"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["template_id"] == template_id
    assert body["name"] == "By status"
    assert body["group_by"] == ["status"]
    assert body["metric"] == "amount"
    assert body["chart_type"] == "line"
    assert "id" in body


def test_create_summary_view_endpoint_404_when_template_missing(client):
    resp = client.post(
        "/templates/999/summary-views",
        json={"name": "V", "group_by": ["status"]},
    )
    assert resp.status_code == 404


def test_create_summary_view_endpoint_422_when_group_by_is_not_a_column(client):
    template_id = _template_with_records(client)
    resp = client.post(
        f"/templates/{template_id}/summary-views",
        json={"name": "V", "group_by": ["nope"]},
    )
    assert resp.status_code == 422


def test_list_summary_views_endpoint_returns_created_views(client):
    template_id = _template_with_records(client)
    client.post(
        f"/templates/{template_id}/summary-views",
        json={"name": "V1", "group_by": ["status"]},
    )
    client.post(
        f"/templates/{template_id}/summary-views",
        json={"name": "V2", "group_by": ["status", "amount"]},
    )
    resp = client.get(f"/templates/{template_id}/summary-views")
    assert resp.status_code == 200
    names = [v["name"] for v in resp.json()]
    assert names == ["V1", "V2"]


def test_list_summary_views_endpoint_404_when_template_missing(client):
    resp = client.get("/templates/999/summary-views")
    assert resp.status_code == 404


def test_delete_summary_view_endpoint(client):
    template_id = _template_with_records(client)
    created = client.post(
        f"/templates/{template_id}/summary-views",
        json={"name": "V", "group_by": ["status"]},
    ).json()
    resp = client.delete(f"/summary-views/{created['id']}")
    assert resp.status_code == 204
    assert client.get(f"/templates/{template_id}/summary-views").json() == []


def test_delete_summary_view_endpoint_404_when_missing(client):
    resp = client.delete("/summary-views/999")
    assert resp.status_code == 404


def test_summary_endpoint_with_multiple_group_by_params(client):
    template_id = _template_with_records(client)
    resp = client.get(
        f"/templates/{template_id}/summary",
        params=[("group_by", "status"), ("group_by", "amount"), ("metric", "amount")],
    )
    assert resp.status_code == 200
    rows = resp.json()
    assert all(set(row["group_values"]) == {"status", "amount"} for row in rows)
    by_combo = {
        (row["group_values"]["status"], row["group_values"]["amount"]): row["count"]
        for row in rows
    }
    assert by_combo == {("Open", 2): 1, ("Open", 3): 1, ("Closed", 5): 1}
