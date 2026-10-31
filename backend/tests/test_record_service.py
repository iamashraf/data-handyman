import pytest

from app.models.template import TemplateColumn
from app.services.record_service import (
    create_record,
    delete_record,
    get_record,
    list_records,
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
