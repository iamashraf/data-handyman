"""Export service: write a template's records to an .xlsx file."""

import io

import openpyxl
import pytest

from app.models.record import RecordRead
from app.models.template import TemplateColumn, TemplateRead
from app.services.export_service import export_template_to_xlsx


def _template(columns: list[TemplateColumn]) -> TemplateRead:
    return TemplateRead(id=1, name="T", columns=columns, created_at="", updated_at="")


def _record(record_id: int, data: dict, computed: dict | None = None) -> RecordRead:
    return RecordRead(
        id=record_id,
        template_id=1,
        data=data,
        computed=computed or {},
        created_at="",
        updated_at="",
    )


def test_export_with_zero_records_produces_valid_file_with_headers():
    template = _template([TemplateColumn(name="status", type="text", formula=None)])
    file_bytes = export_template_to_xlsx(template, records=[])
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes))
    sheet = wb.active
    assert [c.value for c in sheet[1]] == ["status"]
    assert sheet.max_row == 1


def test_export_writes_header_and_raw_values_in_column_order():
    template = _template(
        [
            TemplateColumn(name="status", type="text", formula=None),
            TemplateColumn(name="amount", type="number", formula=None),
        ]
    )
    records = [
        _record(1, {"status": "Open", "amount": 2}),
        _record(2, {"status": "Closed", "amount": 5}),
    ]
    file_bytes = export_template_to_xlsx(template, records=records)
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes))
    sheet = wb.active
    assert [c.value for c in sheet[1]] == ["status", "amount"]
    assert [c.value for c in sheet[2]] == ["Open", 2]
    assert [c.value for c in sheet[3]] == ["Closed", 5]
    assert sheet.max_row == 3


def test_export_writes_computed_value_for_formula_columns_not_a_live_formula():
    template = _template(
        [
            TemplateColumn(name="amount", type="number", formula=None),
            TemplateColumn(name="double", type="number", formula="{amount} * 2"),
        ]
    )
    records = [_record(1, {"amount": 4}, computed={"double": 8})]
    file_bytes = export_template_to_xlsx(template, records=records)
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes))
    sheet = wb.active
    assert [c.value for c in sheet[1]] == ["amount", "double"]
    # The formula column's cell holds the computed numeric value, not an
    # Excel formula string (e.g. not "=A2*2").
    row = [c.value for c in sheet[2]]
    assert row == [4, 8]


def test_export_json_encodes_list_and_dict_values():
    template = _template([TemplateColumn(name="tags", type="text", formula=None)])
    records = [_record(1, {"tags": ["a", "b"]})]
    file_bytes = export_template_to_xlsx(template, records=records)
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes))
    sheet = wb.active
    assert sheet[2][0].value == '["a", "b"]'


def test_export_treats_leading_equals_value_as_literal_text_not_a_formula():
    template = _template([TemplateColumn(name="status", type="text", formula=None)])
    records = [_record(1, {"status": "=1+1"})]
    file_bytes = export_template_to_xlsx(template, records=records)
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes))
    sheet = wb.active
    cell = sheet[2][0]
    assert cell.value == "=1+1"
    assert cell.data_type != "f"


def test_export_include_summary_with_zero_records_has_no_chart():
    template = _template([TemplateColumn(name="status", type="text", formula=None)])
    file_bytes = export_template_to_xlsx(
        template, records=[], include_summary=True, group_by="status"
    )
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes))
    data_sheet = wb["Data"]
    summary_col = len(template.columns) + 2
    assert data_sheet.cell(row=1, column=summary_col).value == "Summary"
    assert [
        data_sheet.cell(row=2, column=summary_col + i).value for i in range(3)
    ] == ["group_value", "count", "sum"]
    assert data_sheet.cell(row=3, column=summary_col).value is None
    assert len(data_sheet._charts) == 0


def test_export_include_summary_without_group_by_raises_value_error():
    template = _template([TemplateColumn(name="status", type="text", formula=None)])
    with pytest.raises(ValueError):
        export_template_to_xlsx(template, records=[], include_summary=True)


def test_export_include_summary_adds_summary_section_with_chart():
    template = _template(
        [
            TemplateColumn(name="status", type="text", formula=None),
            TemplateColumn(name="amount", type="number", formula=None),
        ]
    )
    records = [
        _record(1, {"status": "Open", "amount": 2}),
        _record(2, {"status": "Open", "amount": 3}),
        _record(3, {"status": "Closed", "amount": 5}),
    ]
    file_bytes = export_template_to_xlsx(
        template,
        records=records,
        include_summary=True,
        group_by="status",
        metric="amount",
    )
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes))
    # The summary is a section on the same "Data" sheet -- not a separate
    # tab -- so it's visible as soon as the file opens.
    assert wb.sheetnames == ["Data"]
    data_sheet = wb["Data"]
    summary_col = len(template.columns) + 2
    assert data_sheet.cell(row=1, column=summary_col).value == "Summary"
    assert [
        data_sheet.cell(row=2, column=summary_col + i).value for i in range(3)
    ] == ["group_value", "count", "sum"]
    values = {
        data_sheet.cell(row=r, column=summary_col).value: (
            data_sheet.cell(row=r, column=summary_col + 1).value,
            data_sheet.cell(row=r, column=summary_col + 2).value,
        )
        for r in range(3, data_sheet.max_row + 1)
        if data_sheet.cell(row=r, column=summary_col).value is not None
    }
    assert values["Open"] == (2, 5.0)
    assert values["Closed"] == (1, 5.0)
    # A native bar chart was added to the Data sheet, next to the section.
    assert len(data_sheet._charts) == 1
