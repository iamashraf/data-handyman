"""Export service: write a template's records to an .xlsx workbook.

Formula columns are written as their already-computed *value* (from
`RecordRead.computed`), not as a live Excel formula -- re-deriving a
cross-platform-valid live formula per exported row is out of scope for this
plan (see the Task 9 brief). The file's values match the UI; it just won't
recalculate in Excel if a raw cell is edited.
"""

import io
import json
from typing import Any

from openpyxl import Workbook
from openpyxl.chart import AreaChart, BarChart, LineChart, PieChart, Reference

_CHART_CLASSES = {
    "bar": BarChart,
    "line": LineChart,
    "area": AreaChart,
    "pie": PieChart,
}
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet

from app.models.record import RecordRead
from app.models.template import TemplateRead
from app.services.summary_service import compute_summary


def _cell_value(record: RecordRead, column_name: str, is_formula: bool) -> Any:
    if is_formula:
        return record.computed.get(column_name)
    return record.data.get(column_name)


def _to_excel_safe(value: Any) -> Any:
    """Make a raw Python value safe for an openpyxl cell.

    `data`/`computed` can hold lists or dicts (openpyxl can't write those
    directly), so they're JSON-encoded the same way `summary_service`
    canonicalizes unhashable group values.
    """
    if isinstance(value, (list, dict)):
        return json.dumps(value, sort_keys=True, default=str)
    return value


def _append_row_as_text(sheet: Worksheet, values: list[Any]) -> None:
    """Append a row, then force any `=`-leading string cell to plain text.

    openpyxl auto-detects a string starting with "=" as a live formula.
    A raw value that happens to start with "=" (user-entered text, or a
    JSON-encoded value) must stay literal text, per this task's decision
    to never write live formulas into the export.
    """
    sheet.append(values)
    for cell in sheet[sheet.max_row]:
        if isinstance(cell.value, str) and cell.value.startswith("="):
            cell.data_type = "s"


def _set_cell_as_text_if_formula_like(sheet: Worksheet, row: int, column: int, value: Any) -> None:
    """Same `=`-leading-string guard as `_append_row_as_text`, for a cell
    written by row/column position rather than by appending a whole row."""
    cell = sheet.cell(row=row, column=column, value=value)
    if isinstance(value, str) and value.startswith("="):
        cell.data_type = "s"


def export_template_to_xlsx(
    template: TemplateRead,
    records: list[RecordRead],
    include_summary: bool = False,
    group_by: list[str] | None = None,
    metric: str | None = None,
    chart_type: str = "bar",
) -> bytes:
    if include_summary and not group_by:
        raise ValueError("group_by is required when include_summary is True")

    wb = Workbook()
    data_sheet = wb.active
    data_sheet.title = "Data"

    data_sheet.append([column.name for column in template.columns])
    for record in records:
        row_values = [
            _to_excel_safe(_cell_value(record, column.name, column.formula is not None))
            for column in template.columns
        ]
        _append_row_as_text(data_sheet, row_values)

    if include_summary:
        # Placed as a section on the same "Data" sheet -- a couple of
        # blank columns to the right of the data table -- rather than a
        # separate sheet tab, so it's immediately visible when the file
        # opens instead of something you have to notice a second tab to
        # find.
        summary_rows = compute_summary(records, group_by, metric)
        summary_col = len(template.columns) + 2
        # One column per group_by dimension, then count, then sum.
        group_col_count = len(group_by)

        _set_cell_as_text_if_formula_like(data_sheet, 1, summary_col, "Summary")
        header_row = 2
        headers = [*group_by, "count", "sum"]
        for offset, header in enumerate(headers):
            _set_cell_as_text_if_formula_like(data_sheet, header_row, summary_col + offset, header)
        for i, row in enumerate(summary_rows):
            r = header_row + 1 + i
            for offset, column in enumerate(group_by):
                _set_cell_as_text_if_formula_like(
                    data_sheet, r, summary_col + offset, _to_excel_safe(row.group_values.get(column))
                )
            _set_cell_as_text_if_formula_like(data_sheet, r, summary_col + group_col_count, row.count)
            _set_cell_as_text_if_formula_like(data_sheet, r, summary_col + group_col_count + 1, row.sum)

        if summary_rows:
            last_row = header_row + len(summary_rows)
            count_col = summary_col + group_col_count
            sum_col = count_col + 1
            # Matches the summary view's own single-chart rule: plot the
            # metric total when one was requested, otherwise the count.
            value_col = sum_col if metric else count_col
            chart_class = _CHART_CLASSES.get(chart_type, BarChart)
            chart = chart_class()
            chart.title = "Summary"
            data_ref = Reference(
                data_sheet, min_col=value_col, max_col=value_col,
                min_row=header_row, max_row=last_row,
            )
            # The category axis labels a compound group by its first
            # dimension's column -- openpyxl charts take one category
            # range, not a composite label, same simplification the
            # summary table avoids by giving each dimension its own column.
            categories_ref = Reference(
                data_sheet, min_col=summary_col, min_row=header_row + 1, max_row=last_row
            )
            chart.add_data(data_ref, titles_from_data=True)
            chart.set_categories(categories_ref)
            anchor_col_letter = get_column_letter(summary_col)
            data_sheet.add_chart(chart, f"{anchor_col_letter}{last_row + 3}")

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()
