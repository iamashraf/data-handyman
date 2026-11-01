import pytest

from app.models.summary import SummaryViewCreate
from app.models.template import TemplateColumn, UniqueConstraint
from app.repository import summary_views_repo
from app.repository.records_repo import create_record, list_records
from app.services.template_service import (
    create_template,
    delete_template,
    get_template,
    update_template,
)


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


def test_update_raises_when_both_an_edited_and_an_unedited_formula_break(db_conn):
    # `is_open`'s formula is untouched but broken by removing `status`
    # (destructive-change rule (b)); `total`'s formula is edited in this
    # same request to something broken on its own terms. The self-edited
    # error must win -- raise ValueError (-> 422), not fall through to a
    # 200 "warning".
    columns = [
        TemplateColumn(name="status", type="text", formula=None),
        TemplateColumn(name="is_open", type="boolean", formula='=[@status]="Open"'),
        TemplateColumn(name="total", type="number", formula=None),
    ]
    t = create_template(db_conn, "T", columns)
    with pytest.raises(ValueError):
        update_template(
            db_conn,
            t.id,
            "T",
            [
                TemplateColumn(
                    name="is_open", type="boolean", formula='=[@status]="Open"'
                ),
                TemplateColumn(name="total", type="number", formula="=FOO(1"),
            ],
            force=False,
        )


def test_create_template_with_valid_unique_constraint(db_conn):
    columns = [TemplateColumn(name="serial_no", type="text", formula=None)]
    constraints = [UniqueConstraint(name="Serial No", columns=["serial_no"])]
    t = create_template(db_conn, "T", columns, constraints)
    assert t.unique_constraints == constraints


def test_create_template_rejects_constraint_referencing_unknown_column(db_conn):
    columns = [TemplateColumn(name="serial_no", type="text", formula=None)]
    constraints = [UniqueConstraint(name="Bad", columns=["nope"])]
    with pytest.raises(ValueError, match="unknown"):
        create_template(db_conn, "T", columns, constraints)


def test_create_template_rejects_constraint_on_formula_column(db_conn):
    columns = [
        TemplateColumn(name="a", type="number", formula=None),
        TemplateColumn(name="doubled", type="number", formula="=[@a]*2"),
    ]
    constraints = [UniqueConstraint(name="Bad", columns=["doubled"])]
    with pytest.raises(ValueError, match="formula"):
        create_template(db_conn, "T", columns, constraints)


def test_update_warns_when_new_constraint_conflicts_with_existing_duplicate_data(db_conn):
    columns = [TemplateColumn(name="serial_no", type="text", formula=None)]
    t = create_template(db_conn, "T", columns)
    create_record(db_conn, t.id, {"serial_no": "A1"})
    create_record(db_conn, t.id, {"serial_no": "A1"})

    result = update_template(
        db_conn,
        t.id,
        "T",
        columns,
        unique_constraints=[UniqueConstraint(name="Serial No", columns=["serial_no"])],
        force=False,
    )
    assert result.template is None
    assert result.warning.affected_record_count == 1
    assert any("Serial No" in reason for reason in result.warning.reasons)


def test_update_force_saves_constraint_despite_existing_conflict(db_conn):
    columns = [TemplateColumn(name="serial_no", type="text", formula=None)]
    t = create_template(db_conn, "T", columns)
    create_record(db_conn, t.id, {"serial_no": "A1"})
    create_record(db_conn, t.id, {"serial_no": "A1"})

    result = update_template(
        db_conn,
        t.id,
        "T",
        columns,
        unique_constraints=[UniqueConstraint(name="Serial No", columns=["serial_no"])],
        force=True,
    )
    assert result.template is not None
    assert result.template.unique_constraints[0].name == "Serial No"


def test_update_applies_cleanly_when_new_constraint_has_no_conflicts(db_conn):
    columns = [TemplateColumn(name="serial_no", type="text", formula=None)]
    t = create_template(db_conn, "T", columns)
    create_record(db_conn, t.id, {"serial_no": "A1"})

    result = update_template(
        db_conn,
        t.id,
        "T",
        columns,
        unique_constraints=[UniqueConstraint(name="Serial No", columns=["serial_no"])],
        force=False,
    )
    assert result.template is not None
    assert result.warning is None


def test_delete_template_removes_its_records(db_conn):
    columns = [TemplateColumn(name="status", type="text", formula=None)]
    t = create_template(db_conn, "T", columns)
    create_record(db_conn, t.id, {"status": "Open"})

    delete_template(db_conn, t.id)

    assert list_records(db_conn, t.id) == []


def test_delete_template_removes_its_saved_summary_views(db_conn):
    columns = [TemplateColumn(name="status", type="text", formula=None)]
    t = create_template(db_conn, "T", columns)
    summary_views_repo.create_view(
        db_conn, t.id, SummaryViewCreate(name="By status", group_by=["status"])
    )

    delete_template(db_conn, t.id)

    assert summary_views_repo.list_views(db_conn, t.id) == []


def test_deleted_templates_saved_view_does_not_resurface_on_an_unrelated_template(db_conn):
    # Regression: sqlite ids aren't AUTOINCREMENT, so a freed id can be
    # reused by a later, unrelated template -- a saved view left behind by
    # delete_template would otherwise attach itself to whatever template
    # happens to reuse that id next, surfacing a summary view whose
    # group_by columns don't exist on the new template at all.
    old = create_template(db_conn, "Old", [TemplateColumn(name="region", type="text", formula=None)])
    summary_views_repo.create_view(
        db_conn, old.id, SummaryViewCreate(name="By region", group_by=["region"])
    )
    delete_template(db_conn, old.id)

    new = create_template(db_conn, "New", [TemplateColumn(name="status", type="text", formula=None)])

    assert summary_views_repo.list_views(db_conn, new.id) == []
