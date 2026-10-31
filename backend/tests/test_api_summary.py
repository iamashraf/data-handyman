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
    by_group = {row["group_value"]: row for row in resp.json()}
    assert by_group["Open"] == {"group_value": "Open", "count": 2, "sum": 5.0}
    assert by_group["Closed"] == {"group_value": "Closed", "count": 1, "sum": 5.0}


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
    assert resp.json() == [{"group_value": '["a"]', "count": 2, "sum": None}]


def test_summary_endpoint_404_when_template_missing(client):
    resp = client.get("/templates/999/summary", params={"group_by": "status"})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Template not found"
