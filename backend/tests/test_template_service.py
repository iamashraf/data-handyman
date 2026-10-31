import pytest

from app.models.template import TemplateColumn
from app.repository.records_repo import create_record
from app.services.template_service import create_template, get_template, update_template


def test_update_warns_when_removing_column_with_data(db_conn):
    columns = [TemplateColumn(name="status", type="text", formula=None)]
    t = create_template(db_conn, "T", columns)
    create_record(db_conn, t.id, {"status": "Open"})
    result = update_template(db_conn, t.id, "T", [], force=False)
    assert result.template is None
    assert result.warning.affected_record_count == 1


def test_update_warns_when_removing_column_breaks_another_columns_formula(db_conn):
    columns = [
        TemplateColumn(name="status", type="text", formula=None),
        TemplateColumn(name="is_open", type="boolean", formula='=[@status]="Open"'),
    ]
    t = create_template(db_conn, "T", columns)
    # Remove `status`, leaving `is_open`'s formula referencing a column that no longer exists.
    result = update_template(
        db_conn,
        t.id,
        "T",
        [TemplateColumn(name="is_open", type="boolean", formula='=[@status]="Open"')],
        force=False,
    )
    assert result.template is None
    assert "is_open" in " ".join(result.warning.reasons)


def test_update_without_force_applies_nothing(db_conn):
    columns = [TemplateColumn(name="status", type="text", formula=None)]
    t = create_template(db_conn, "T", columns)
    create_record(db_conn, t.id, {"status": "Open"})
    update_template(db_conn, t.id, "T", [], force=False)
    unchanged = get_template(db_conn, t.id)
    assert unchanged.columns == columns


def test_update_with_force_applies_destructive_change(db_conn):
    columns = [TemplateColumn(name="status", type="text", formula=None)]
    t = create_template(db_conn, "T", columns)
    create_record(db_conn, t.id, {"status": "Open"})
    result = update_template(db_conn, t.id, "T", [], force=True)
    assert result.template is not None
    assert result.template.columns == []


def test_update_raises_on_self_edited_invalid_formula(db_conn):
    # Editing a column's own formula to reference an unknown column is a
    # plain authoring error (not caused by removing some other column), so
    # it must raise -- not come back as a destructive-change warning.
    columns = [TemplateColumn(name="status", type="text", formula=None)]
    t = create_template(db_conn, "T", columns)
    with pytest.raises(ValueError):
        update_template(
            db_conn,
            t.id,
            "T",
            [TemplateColumn(name="status", type="text", formula="=[@ghost]")],
            force=False,
        )
