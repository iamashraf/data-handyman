import pytest

from app.repository.records_repo import (
    create_record,
    delete_record,
    get_record,
    list_records,
    update_record,
)


def test_create_and_get_record(db_conn):
    created = create_record(db_conn, template_id=1, data={"status": "Open"})
    fetched = get_record(db_conn, created.id)
    assert fetched.data == {"status": "Open"}
    assert fetched.template_id == 1


def test_get_record_returns_none_when_missing(db_conn):
    assert get_record(db_conn, 999) is None


def test_list_records_filters_by_template_id(db_conn):
    first = create_record(db_conn, template_id=1, data={"n": 1})
    create_record(db_conn, template_id=2, data={"n": 2})
    second = create_record(db_conn, template_id=1, data={"n": 3})
    assert list_records(db_conn, template_id=1) == [first, second]


def test_update_record_replaces_data(db_conn):
    created = create_record(db_conn, template_id=1, data={"status": "Open"})
    updated = update_record(db_conn, created.id, {"status": "Closed"})
    assert updated.id == created.id
    assert updated.template_id == 1
    assert updated.data == {"status": "Closed"}
    assert get_record(db_conn, created.id) == updated


def test_update_missing_record_raises(db_conn):
    with pytest.raises(LookupError):
        update_record(db_conn, 999, {"status": "Nope"})


def test_delete_record_removes_row(db_conn):
    created = create_record(db_conn, template_id=1, data={})
    delete_record(db_conn, created.id)
    assert get_record(db_conn, created.id) is None
    assert list_records(db_conn, template_id=1) == []


def test_delete_missing_record_is_noop(db_conn):
    delete_record(db_conn, 999)
