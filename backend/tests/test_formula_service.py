import pytest

from app.services.formula_service import (
    FormulaError,
    evaluate_formula,
    validate_formula,
)


def test_evaluate_simple_if_formula():
    result = evaluate_formula(
        '=IF([@status]="Open","Pending","Closed")', {"status": "Open"}
    )
    assert result == "Pending"


def test_evaluate_raises_formula_error_on_missing_column():
    with pytest.raises(FormulaError):
        evaluate_formula("=[@missing_col]", {"status": "Open"})


def test_validate_formula_flags_unknown_column():
    errors = validate_formula("=[@missing_col]", column_names=["status"])
    assert errors != []


def test_validate_formula_accepts_known_column():
    errors = validate_formula(
        '=IF([@status]="Open","Pending","Closed")', column_names=["status"]
    )
    assert errors == []


def test_validate_formula_flags_unknown_function():
    errors = validate_formula(
        '=IFF([@status]="Open","Pending","Closed")', column_names=["status"]
    )
    assert errors != []


def test_validate_formula_does_not_false_positive_on_dummy_division_by_zero():
    # Dummy substitution (both refs -> 1) would make this formula compute
    # 1/0 during the dry-run; that must not count as invalid, since the
    # real row data (not the placeholder) determines per-record #VALUE!.
    errors = validate_formula(
        "=[@numerator]/[@denominator]", column_names=["numerator", "denominator"]
    )
    assert errors == []


def test_evaluate_returns_plain_bool_not_numpy_bool():
    result = evaluate_formula("=NOT([@flag])", {"flag": True})
    assert result is False
    assert type(result) is bool


def test_evaluate_ignores_bracket_token_inside_string_literal():
    # `[@fake]` here is a quoted IF branch value, not a reference to a
    # column named "fake" -- must not be substituted, and must not raise
    # FormulaError for a "missing" column that was never really referenced.
    result = evaluate_formula('=IF([@status]="[@fake]","x","y")', {"status": "[@fake]"})
    assert result == "x"


def test_evaluate_preserves_literal_text_containing_bracket_token():
    result = evaluate_formula('=IF([@status]="Open","[@fake]","y")', {"status": "Open"})
    assert result == "[@fake]"


def test_validate_formula_ignores_bracket_token_inside_string_literal():
    errors = validate_formula(
        '=IF([@status]="[@fake]","x","y")', column_names=["status"]
    )
    assert errors == []
