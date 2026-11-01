from app.models.template import UniqueConstraint
from app.services.unique_constraint_service import (
    conflict_message,
    conflicting_constraints,
    find_conflict,
)


def test_find_conflict_detects_single_column_duplicate():
    constraints = [UniqueConstraint(name="Serial No", columns=["serial_no"])]
    conflict = find_conflict(constraints, {"serial_no": "A1"}, [{"serial_no": "A1"}])
    assert conflict is not None
    assert conflict.name == "Serial No"


def test_find_conflict_requires_every_constraint_column_to_match():
    constraints = [UniqueConstraint(name="Region+Year", columns=["region", "year"])]
    others = [{"region": "West", "year": 2024}]
    assert find_conflict(constraints, {"region": "West", "year": 2025}, others) is None
    assert find_conflict(constraints, {"region": "West", "year": 2024}, others) is not None


def test_find_conflict_treats_blank_as_never_conflicting():
    constraints = [UniqueConstraint(name="Serial No", columns=["serial_no"])]
    others = [{"serial_no": None}, {"serial_no": None}]
    assert find_conflict(constraints, {"serial_no": None}, others) is None


def test_find_conflict_returns_none_when_no_constraints_configured():
    assert find_conflict([], {"serial_no": "A1"}, [{"serial_no": "A1"}]) is None


def test_conflicting_constraints_counts_affected_records_not_the_first_occurrence():
    constraints = [UniqueConstraint(name="Serial No", columns=["serial_no"])]
    records_data = [{"serial_no": "A1"}, {"serial_no": "A1"}, {"serial_no": "A1"}, {"serial_no": "B2"}]
    results = conflicting_constraints(constraints, records_data)
    assert len(results) == 1
    constraint, affected = results[0]
    assert constraint.name == "Serial No"
    assert affected == 2  # two of the three A1 records are "the duplicate"


def test_conflicting_constraints_ignores_blanks_and_clean_constraints():
    constraints = [
        UniqueConstraint(name="Serial No", columns=["serial_no"]),
        UniqueConstraint(name="Email", columns=["email"]),
    ]
    records_data = [
        {"serial_no": None, "email": "a@x.com"},
        {"serial_no": None, "email": "b@x.com"},
        {"serial_no": "A1", "email": "c@x.com"},
    ]
    assert conflicting_constraints(constraints, records_data) == []


def test_conflict_message_names_the_constraint_and_its_columns():
    constraint = UniqueConstraint(name="Region+Year", columns=["region", "year"])
    message = conflict_message(constraint)
    assert "Region+Year" in message
    assert "region" in message and "year" in message
