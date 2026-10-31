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
from openpyxl.chart import BarChart, Reference
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


def export_template_to_xlsx(
    template: TemplateRead,
    records: list[RecordRead],
    include_summary: bool = False,
    group_by: str | None = None,
    metric: str | None = None,
) -> bytes:
    if include_summary and group_by is None:
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
        summary_rows = compute_summary(records, group_by, metric)
        summary_sheet = wb.create_sheet("Summary")
        summary_sheet.append(["group_value", "count", "sum"])
        for row in summary_rows:
            _append_row_as_text(
                summary_sheet,
                [_to_excel_safe(row.group_value), row.count, row.sum],
            )

        if summary_rows:
            chart = BarChart()
            chart.title = "Summary"
            last_row = summary_sheet.max_row
            data_ref = Reference(
                summary_sheet, min_col=2, max_col=2, min_row=1, max_row=last_row
            )
            categories_ref = Reference(
                summary_sheet, min_col=1, min_row=2, max_row=last_row
            )
            chart.add_data(data_ref, titles_from_data=True)
            chart.set_categories(categories_ref)
            summary_sheet.add_chart(chart, "E2")

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()
