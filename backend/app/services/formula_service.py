"""Excel-style formula evaluation against a plain dict of row values.

Formulas use Excel's structured-reference syntax to refer to other columns
in the same row, e.g. ``=IF([@status]="Open","Pending","Closed")``.

Mechanism: a ``[@column_name]`` token is not a reference the `formulas`
library understands directly (it models real worksheet cells, not ad-hoc
per-row structured references). So each token is first substituted with the
row's actual value, formatted as a literal Excel token (strings quoted,
numbers/booleans bare), leaving a plain literal-only formula string, which
`formulas` then parses and evaluates on its own.

Known boundary: supported syntax is whatever the `formulas` library
supports (logical, lookup, text, math, date/time functions, comparison and
arithmetic operators) minus structured/range references, since every
`[@col]` token is resolved to a scalar literal before evaluation. Whole-
column/range formulas (e.g. `SUM(table[col])`) are out of scope.
"""

import re
from typing import Any

import formulas
import numpy as np
from formulas.functions import XlError

_REF_PATTERN = re.compile(r"\[@([^\]]+)\]")


class FormulaError(Exception):
    """Raised when a formula fails to parse/evaluate for a given row."""


def _extract_refs(expression: str) -> list[str]:
    return _REF_PATTERN.findall(expression)


def _substitute_refs(expression: str, literal_for) -> str:
    return _REF_PATTERN.sub(lambda m: literal_for(m.group(1)), expression)


def _format_literal(value: Any) -> str:
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if value is None:
        return '""'
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, str):
        return '"' + value.replace('"', '""') + '"'
    raise FormulaError(
        f"Unsupported value type for formula substitution: {type(value)!r}"
    )


def _as_formula(expression: str) -> str:
    expression = expression.strip()
    return expression if expression.startswith("=") else f"={expression}"


def _unwrap(result: Any) -> Any:
    value = result.tolist() if hasattr(result, "tolist") else result
    while isinstance(value, list):
        value = value[0]
    # Some functions (e.g. NOT) hand back a numpy scalar instead of a plain
    # Python one even after `.tolist()`; unwrap it so callers (and Pydantic
    # response models) get a plain bool/int/float, not e.g. numpy.bool_.
    if isinstance(value, np.generic):
        value = value.item()
    return value


def evaluate_formula(expression: str, row: dict[str, Any]) -> Any:
    """Substitute `[@col]` tokens with `row` values and evaluate.

    Raises FormulaError if a referenced column is missing from `row`, or
    evaluation fails (parse error, unsupported function, or the formula
    evaluates to an Excel error value such as #DIV/0!).
    """
    for col in _extract_refs(expression):
        if col not in row:
            raise FormulaError(
                f"Column '{col}' referenced in formula is not present in row data"
            )

    literal_expression = _substitute_refs(
        expression, lambda col: _format_literal(row[col])
    )

    try:
        parser = formulas.Parser()
        ast = parser.ast(_as_formula(literal_expression))
        func = ast[1].compile()
        result = func()
    except Exception as exc:
        raise FormulaError(f"Formula evaluation failed: {exc}") from exc

    value = _unwrap(result)
    if isinstance(value, XlError):
        raise FormulaError(f"Formula evaluated to Excel error: {value}")
    return value


def validate_formula(expression: str, column_names: list[str]) -> list[str]:
    """Check that `expression` parses and every `[@...]` ref is known.

    Does not require real row data: this is a syntax + reference check
    only, not a full evaluation (a formula can pass validation here and
    still fail per-record, e.g. `=[@a]/[@b]` when `b` is 0 for a given
    record — that is handled by `evaluate_formula`/`FormulaError`, not here).
    """
    errors: list[str] = []
    refs = _extract_refs(expression)

    for col in refs:
        if col not in column_names:
            errors.append(f"Unknown column '{col}' referenced in formula")

    # Substitute every reference with a dummy literal and run it: `formulas`
    # only catches things like unknown function names at call time, not when
    # just building/compiling the AST (confirmed empirically). The dummy
    # value's *result* (e.g. a #DIV/0! from a dummy-caused division) is not
    # a validation error -- only an exception raised while parsing/running
    # the formula is, since that reflects the formula itself, not the data.
    dummy_expression = _substitute_refs(expression, lambda _col: "1")
    try:
        parser = formulas.Parser()
        ast = parser.ast(_as_formula(dummy_expression))
        func = ast[1].compile()
        func()
    except Exception as exc:  # noqa: BLE001
        errors.append(f"Formula does not parse: {exc}")

    return errors
