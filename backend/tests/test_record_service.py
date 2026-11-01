import pytest

from app.models.template import TemplateColumn, UniqueConstraint
from app.services.record_service import (
    create_record,
    delete_record,
    get_record,
    list_records,
    update_record,
)
from app.services.template_service import create_template


def test_list_records_isolates_formula_errors(db_conn):
    columns = [
        TemplateColumn(name="numerator", type="number", formula=None),
        TemplateColumn(name="denominator", type="number", formula=None),
        TemplateColumn(
            name="ratio", type="number", formula="=[@numerator]/[@denominator]"
        ),
    ]
    t = create_template(db_conn, "T", columns)
    create_record(db_conn, t.id, {"numerator": 10, "denominator": 2})
    create_record(db_conn, t.id, {"numerator": 5, "denominator": 0})  # triggers #VALUE!

    results = list_records(db_conn, t.id)

    assert len(results) == 2
    good, bad = sorted(results, key=lambda r: r.data["denominator"], reverse=True)
    assert good.computed["ratio"] == 5
    assert bad.computed["ratio"] == "#VALUE!"


def test_computed_isolates_formula_errors_within_a_single_record(db_conn):
    # Same template, same record: one formula column fails while another
    # formula column on that same record must still compute correctly.
    columns = [
        TemplateColumn(name="numerator", type="number", formula=None),
        TemplateColumn(name="denominator", type="number", formula=None),
        TemplateColumn(
            name="ratio", type="number", formula="=[@numerator]/[@denominator]"
        ),
        TemplateColumn(name="doubled", type="number", formula="=[@numerator]*2"),
    ]
    t = create_template(db_conn, "T", columns)
    record = create_record(db_conn, t.id, {"numerator": 5, "denominator": 0})

    assert record.computed["ratio"] == "#VALUE!"
    assert record.computed["doubled"] == 10


def test_get_record_raises_when_missing(db_conn):
    with pytest.raises(LookupError):
        get_record(db_conn, 999)


def test_delete_record_raises_when_missing(db_conn):
    with pytest.raises(LookupError):
        delete_record(db_conn, 999)


def test_list_records_search_filters_by_substring(db_conn):
    columns = [TemplateColumn(name="status", type="text", formula=None)]
    t = create_template(db_conn, "T", columns)
    create_record(db_conn, t.id, {"status": "Open"})
    create_record(db_conn, t.id, {"status": "Closed"})
    results = list_records(db_conn, t.id, search="open")
    assert len(results) == 1
    assert results[0].data["status"] == "Open"


def _template_with_unique_serial(db_conn):
    columns = [TemplateColumn(name="serial_no", type="text", formula=None)]
    constraints = [UniqueConstraint(name="Serial No", columns=["serial_no"])]
    return create_template(db_conn, "T", columns, constraints)


def test_create_record_raises_on_unique_constraint_violation(db_conn):
    t = _template_with_unique_serial(db_conn)
    create_record(db_conn, t.id, {"serial_no": "A1"})
    with pytest.raises(ValueError, match="Serial No"):
        create_record(db_conn, t.id, {"serial_no": "A1"})


def test_create_record_allows_blank_value_to_repeat(db_conn):
    t = _template_with_unique_serial(db_conn)
    create_record(db_conn, t.id, {"serial_no": None})
    created = create_record(db_conn, t.id, {"serial_no": None})
    assert created.data["serial_no"] is None


def test_update_record_raises_when_new_value_collides_with_another_record(db_conn):
    t = _template_with_unique_serial(db_conn)
    create_record(db_conn, t.id, {"serial_no": "A1"})
    second = create_record(db_conn, t.id, {"serial_no": "A2"})
    with pytest.raises(ValueError, match="Serial No"):
        update_record(db_conn, second.id, {"serial_no": "A1"})


def test_update_record_allows_keeping_its_own_value(db_conn):
    t = _template_with_unique_serial(db_conn)
    record = create_record(db_conn, t.id, {"serial_no": "A1"})
    # Re-saving the same record with its own unchanged value must not
    # conflict with itself.
    updated = update_record(db_conn, record.id, {"serial_no": "A1"})
    assert updated.data["serial_no"] == "A1"
