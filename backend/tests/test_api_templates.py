from app.repository.records_repo import create_record


def test_put_without_force_returns_warning_status(client, db_conn):
    create_resp = client.post(
        "/templates",
        json={
            "name": "T",
            "columns": [{"name": "status", "type": "text", "formula": None}],
        },
    )
    template_id = create_resp.json()["id"]
    # The /records API endpoint doesn't exist until Task 7 — create the record
    # directly via the repository (Task 4) to keep this task self-contained.
    create_record(db_conn, template_id, {"status": "Open"})
    resp = client.put(
        f"/templates/{template_id}", json={"name": "T", "columns": [], "force": False}
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "warning"


def test_put_with_self_edited_invalid_formula_returns_422(client, db_conn):
    create_resp = client.post(
        "/templates",
        json={
            "name": "T",
            "columns": [{"name": "status", "type": "text", "formula": None}],
        },
    )
    template_id = create_resp.json()["id"]
    resp = client.put(
        f"/templates/{template_id}",
        json={
            "name": "T",
            "columns": [{"name": "status", "type": "text", "formula": "=[@ghost]"}],
            "force": False,
        },
    )
    assert resp.status_code == 422
