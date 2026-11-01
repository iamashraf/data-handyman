import json

import pytest

from app.models.template import TemplateColumn, UniqueConstraint
from app.repository.templates_repo import (
    create_template,
    delete_template,
    get_template,
    list_templates,
    update_template,
)


def test_create_and_get_template(db_conn):
    columns = [TemplateColumn(name="status", type="text", formula=None)]
    created = create_template(db_conn, "Test Template", columns)
    fetched = get_template(db_conn, created.id)
    assert fetched.name == "Test Template"
    assert fetched.columns == columns


def test_get_template_returns_none_when_missing(db_conn):
    assert get_template(db_conn, 999) is None


def test_list_templates_returns_all_in_id_order(db_conn):
    first = create_template(db_conn, "First", [])
    second = create_template(db_conn, "Second", [])
    assert list_templates(db_conn) == [first, second]


def test_update_template_replaces_name_and_columns(db_conn):
    created = create_template(db_conn, "Old", [])
    columns = [
        TemplateColumn(name="amount", type="number", formula="=A1*2"),
        TemplateColumn(name="done", type="boolean", formula=None),
    ]
    updated = update_template(db_conn, created.id, "New", columns)
    assert updated.id == created.id
    assert updated.name == "New"
    assert updated.columns == columns
    assert get_template(db_conn, created.id) == updated


def test_update_missing_template_raises(db_conn):
    with pytest.raises(LookupError):
        update_template(db_conn, 999, "Nope", [])


def test_create_and_get_template_round_trips_unique_constraints(db_conn):
    columns = [TemplateColumn(name="serial_no", type="text", formula=None)]
    constraints = [UniqueConstraint(name="Serial No", columns=["serial_no"])]
    created = create_template(db_conn, "T", columns, constraints)
    assert created.unique_constraints == constraints
    fetched = get_template(db_conn, created.id)
    assert fetched.unique_constraints == constraints


def test_get_template_reads_legacy_bare_column_array_schema_as_no_constraints(db_conn):
    # Before unique constraints existed, `schema` stored a bare column array
    # instead of {"columns": [...], "unique_constraints": [...]}. A template
    # saved under the old shape must still load fine, with no constraints.
    legacy_schema = json.dumps(
        [{"name": "status", "type": "text", "formula": None}]
    )
    cursor = db_conn.execute(
        "INSERT INTO templates (name, schema, created_at, updated_at) VALUES (?, ?, ?, ?)",
        ("Legacy", legacy_schema, "", ""),
    )
    db_conn.commit()
    fetched = get_template(db_conn, cursor.lastrowid)
    assert fetched.columns == [TemplateColumn(name="status", type="text", formula=None)]
    assert fetched.unique_constraints == []


def test_delete_template_removes_row(db_conn):
    created = create_template(db_conn, "Doomed", [])
    delete_template(db_conn, created.id)
    assert get_template(db_conn, created.id) is None
    assert list_templates(db_conn) == []


def test_delete_missing_template_is_noop(db_conn):
    delete_template(db_conn, 999)
