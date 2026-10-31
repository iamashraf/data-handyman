def test_create_list_and_search_records(client):
    t = client.post(
        "/templates",
        json={
            "name": "T",
            "columns": [{"name": "status", "type": "text", "formula": None}],
        },
    ).json()
    client.post(f"/templates/{t['id']}/records", json={"data": {"status": "Open"}})
    client.post(f"/templates/{t['id']}/records", json={"data": {"status": "Closed"}})
    resp = client.get(f"/templates/{t['id']}/records", params={"search": "open"})
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_get_record_returns_404_when_missing(client):
    resp = client.get("/records/999")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Record not found"


def test_update_record_returns_404_when_missing(client):
    resp = client.put("/records/999", json={"data": {}})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Record not found"


def test_delete_record_returns_404_when_missing(client):
    resp = client.delete("/records/999")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Record not found"


def test_get_update_delete_record_roundtrip(client):
    t = client.post(
        "/templates",
        json={
            "name": "T",
            "columns": [{"name": "status", "type": "text", "formula": None}],
        },
    ).json()
    created = client.post(
        f"/templates/{t['id']}/records", json={"data": {"status": "Open"}}
    )
    assert created.status_code == 201
    record_id = created.json()["id"]

    fetched = client.get(f"/records/{record_id}")
    assert fetched.status_code == 200
    assert fetched.json()["data"] == {"status": "Open"}

    updated = client.put(f"/records/{record_id}", json={"data": {"status": "Closed"}})
    assert updated.status_code == 200
    assert updated.json()["data"] == {"status": "Closed"}

    deleted = client.delete(f"/records/{record_id}")
    assert deleted.status_code == 204
    assert client.get(f"/records/{record_id}").status_code == 404
