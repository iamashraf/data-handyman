from app.repository.records_repo import create_record


def test_post_with_invalid_unique_constraint_column_returns_422(client):
    resp = client.post(
        "/templates",
        json={
            "name": "T",
            "columns": [{"name": "status", "type": "text", "formula": None}],
            "unique_constraints": [{"name": "Bad", "columns": ["does_not_exist"]}],
        },
    )
    assert resp.status_code == 422


def test_put_with_constraint_conflicting_existing_data_returns_warning_then_applies_with_force(
    client, db_conn
):
    create_resp = client.post(
        "/templates",
        json={
            "name": "T",
            "columns": [{"name": "serial_no", "type": "text", "formula": None}],
        },
    )
    template_id = create_resp.json()["id"]
    # Two existing records already share the same serial_no value -- adding
    # a unique constraint over that column now conflicts with existing data.
    create_record(db_conn, template_id, {"serial_no": "A1"})
    create_record(db_conn, template_id, {"serial_no": "A1"})

    columns = [{"name": "serial_no", "type": "text", "formula": None}]
    constraints = [{"name": "Serial No", "columns": ["serial_no"]}]

    warn_resp = client.put(
        f"/templates/{template_id}",
        json={"name": "T", "columns": columns, "unique_constraints": constraints, "force": False},
    )
    assert warn_resp.status_code == 200
    body = warn_resp.json()
    assert body["status"] == "warning"
    assert any("Serial No" in reason for reason in body["reasons"])

    # The warning doesn't persist anything -- the template still has no
    # constraints until the user confirms with force: true.
    unchanged = client.get(f"/templates/{template_id}").json()
    assert unchanged["unique_constraints"] == []

    applied_resp = client.put(
        f"/templates/{template_id}",
        json={"name": "T", "columns": columns, "unique_constraints": constraints, "force": True},
    )
    assert applied_resp.status_code == 200
    applied_body = applied_resp.json()
    assert applied_body["status"] == "applied"
    assert applied_body["template"]["unique_constraints"] == constraints

    persisted = client.get(f"/templates/{template_id}").json()
    assert persisted["unique_constraints"] == constraints


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
