import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { AgGridReact, useGridCellEditor } from "ag-grid-react";
import type { CustomCellEditorProps } from "ag-grid-react";
import { ModuleRegistry, AllCommunityModule, themeQuartz } from "ag-grid-community";
import type {
  CellEditingStoppedEvent,
  CellValueChangedEvent,
  ColDef,
  ICellRendererParams,
} from "ag-grid-community";
import {
  ApiError,
  createRecord,
  createTemplateFromExcel,
  deleteRecord,
  exportTemplate,
  getTemplate,
  importTemplate,
  listRecords,
  listTemplates,
  updateRecord,
} from "../api/client";
import type { ImportResult, RecordRead, TemplateColumn, TemplateRead } from "../api/types";
import { DateInput } from "../components/DateInput";
import { useTheme } from "../lib/ThemeContext";
import {
  choiceTintClass,
  columnLabel,
  formatDateValue,
  formatNumberValue,
  isAlertBoolean,
  isSummableFormat,
} from "../lib/columnFormat";
import "./DataViewPage.css";

ModuleRegistry.registerModules([AllCommunityModule]);

const SEARCH_DEBOUNCE_MS = 150;
const COLUMN_STATE_PREFIX = "data-handyman:columns:";

const GRID_FONT_FAMILY = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const gridThemeLight = themeQuartz.withParams({
  accentColor: "#42785c",
  backgroundColor: "#fbfbf7",
  foregroundColor: "#2b362a",
  headerBackgroundColor: "#e5ebdc",
  headerTextColor: "#2b362a",
  headerFontWeight: 600,
  oddRowBackgroundColor: "#fbfbf7",
  rowHoverColor: "#eef1e6",
  borderColor: "#c3cdb9",
  wrapperBorder: { color: "#c3cdb9" },
  wrapperBorderRadius: 7,
  cellTextColor: "#2b362a",
  checkboxCheckedBackgroundColor: "#42785c",
  checkboxCheckedBorderColor: "#42785c",
  checkboxCheckedShapeColor: "#f8faf5",
  checkboxUncheckedBorderColor: "#c3cdb9",
  fontFamily: GRID_FONT_FAMILY,
  cellFontFamily: GRID_FONT_FAMILY,
  headerFontFamily: GRID_FONT_FAMILY,
  spacing: 8,
  rowHeight: 40,
  headerHeight: 40,
});

const gridThemeDark = themeQuartz.withParams({
  accentColor: "#34d17a",
  backgroundColor: "#1e2123",
  foregroundColor: "#e9ece9",
  headerBackgroundColor: "#212426",
  headerTextColor: "#e9ece9",
  headerFontWeight: 600,
  oddRowBackgroundColor: "#1e2123",
  rowHoverColor: "#272b2d",
  borderColor: "#34393b",
  wrapperBorder: { color: "#34393b" },
  wrapperBorderRadius: 7,
  cellTextColor: "#e9ece9",
  checkboxCheckedBackgroundColor: "#34d17a",
  checkboxCheckedBorderColor: "#34d17a",
  checkboxCheckedShapeColor: "#06240f",
  checkboxUncheckedBorderColor: "#34393b",
  fontFamily: GRID_FONT_FAMILY,
  cellFontFamily: GRID_FONT_FAMILY,
  headerFontFamily: GRID_FONT_FAMILY,
  spacing: 8,
  rowHeight: 40,
  headerHeight: 40,
});

interface DataViewPageProps {
  templateId?: number;
}

const TEMP_ROW_PREFIX = "new-";

function isTempRowId(id: unknown): boolean {
  return typeof id === "string" && id.startsWith(TEMP_ROW_PREFIX);
}

function defaultDraftValue(columnType: TemplateColumn["type"]): unknown {
  return columnType === "boolean" ? false : null;
}

/** Merges a record's raw and computed fields into one flat row keyed by
 *  column name, which is what AG-Grid's columnDefs (built from the
 *  template's column list) expect. */
function flattenRecord(record: RecordRead): Record<string, unknown> {
  return { id: record.id, ...record.data, ...record.computed };
}

function describeApiError(error: ApiError): string {
  const body = error.body;
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") {
      return detail;
    }
  }
  return "Something went wrong. Please try again.";
}

function describeImportError(error: { row_number: number; reason: string }): string {
  return `Row ${error.row_number}: ${error.reason}`;
}

/* ---------- cell renderers ---------- */

function TextCell(params: ICellRendererParams) {
  const text = params.value == null ? "" : String(params.value);
  return <span title={text || undefined}>{text}</span>;
}

function NumberCell(params: ICellRendererParams & { column?: TemplateColumn }) {
  const col = params.column;
  if (!col) return null;
  const text = formatNumberValue(params.value, col);
  const isFormulaError = params.value === "#VALUE!";
  if (isFormulaError) {
    return (
      <span className="dv-cell-error" title="This formula couldn't be calculated for this row.">
        #VALUE!
      </span>
    );
  }
  return <span>{text}</span>;
}

function DateCell(params: ICellRendererParams) {
  return <span>{formatDateValue(params.value)}</span>;
}

function BooleanCell(params: ICellRendererParams & { column?: TemplateColumn }) {
  const col = params.column;
  const value = params.value;
  if (col?.formula != null && isAlertBoolean(col)) {
    return value ? <span className="dv-alert-badge">Overdue</span> : null;
  }
  return value ? (
    <span className="dv-check" aria-label="Yes">
      ✓
    </span>
  ) : null;
}

function ChoiceCell(params: ICellRendererParams & { column?: TemplateColumn }) {
  const col = params.column;
  const value = params.value;
  if (value == null || value === "" || !col) return null;
  return <span className={`dv-badge ${choiceTintClass(col, String(value))}`}>{String(value)}</span>;
}

/* ---------- cell editors ---------- */

// ag-grid-react 36's custom cell editors are controlled via the
// `value`/`onValueChange` props (CustomCellEditorProps), not the older
// forwardRef + useImperativeHandle().getValue() pattern -- that older
// pattern is silently never invoked by this version, so a component
// built that way never reports its typed value back to the grid at all.
function DateCellEditor(props: CustomCellEditorProps) {
  return (
    <div className="dv-date-cell-editor">
      <DateInput
        value={(props.value as string | null) ?? null}
        autoFocus
        onChange={(iso) => props.onValueChange(iso)}
        onCommit={() => props.api.stopEditing()}
      />
    </div>
  );
}

function NumberCellEditor(props: CustomCellEditorProps) {
  const [text, setText] = useState(props.value == null ? "" : String(props.value));
  useGridCellEditor({
    isCancelAfterEnd: () => text.trim() !== "" && Number.isNaN(Number(text)),
  });
  return (
    <input
      className="dv-number-cell-editor"
      type="number"
      autoFocus
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        props.onValueChange(next.trim() === "" ? null : Number(next));
      }}
    />
  );
}

/* ---------- row actions menu ---------- */

function RowActionsCell(
  params: ICellRendererParams & {
    onEditForm?: (id: number | string) => void;
    onDuplicate?: (id: number | string) => void;
    onDelete?: (id: number | string) => void;
  }
) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = params.data?.id;
  const label = params.data ? String(Object.values(params.data)[1] ?? id) : "row";

  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(event: MouseEvent) {
      if (
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node) &&
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  if (id == null || params.node.rowPinned) return null;

  function toggleOpen() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - 140) });
    }
    setOpen((o) => !o);
  }

  // AG-Grid cells clip overflow, so the menu can't be a plain absolutely
  // positioned child -- it's portaled to <body> and fixed-positioned
  // against the button's own bounding rect instead, or it would render
  // invisibly (clipped) even though it's technically in the DOM.
  return (
    <div className="dv-row-actions">
      <button
        ref={buttonRef}
        type="button"
        className="dv-row-actions-button"
        aria-label={`Row actions for ${label}`}
        onClick={toggleOpen}
      >
        ⋯
      </button>
      {open && menuPos
        ? createPortal(
            <div
              className="dv-row-actions-menu dv-row-actions-menu-portal"
              role="menu"
              ref={menuRef}
              style={{ top: menuPos.top, left: menuPos.left }}
            >
              <button type="button" role="menuitem" onClick={() => { setOpen(false); params.onEditForm?.(id); }}>
                Edit in form
              </button>
              <button type="button" role="menuitem" onClick={() => { setOpen(false); params.onDuplicate?.(id); }}>
                Duplicate
              </button>
              <button
                type="button"
                role="menuitem"
                className="dv-row-actions-delete"
                onClick={() => { setOpen(false); params.onDelete?.(id); }}
              >
                Delete
              </button>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

export function DataViewPage({ templateId }: DataViewPageProps) {
  const theme = useTheme();
  const [templates, setTemplates] = useState<TemplateRead[]>([]);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [rowCounts, setRowCounts] = useState<Record<number, number>>({});
  const [selectedId, setSelectedId] = useState<number | undefined>(templateId);
  const [template, setTemplate] = useState<TemplateRead | null>(null);
  const [records, setRecords] = useState<RecordRead[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [quickFilter, setQuickFilter] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [gridError, setGridError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importInputKey, setImportInputKey] = useState(0);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [columnsMenuFilter, setColumnsMenuFilter] = useState("");
  const [dataMenuOpen, setDataMenuOpen] = useState(false);
  const [newTemplateDialogOpen, setNewTemplateDialogOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [creatingFromExcel, setCreatingFromExcel] = useState(false);
  const [createFromExcelError, setCreateFromExcelError] = useState<string | null>(null);
  const [createFromExcelInputKey, setCreateFromExcelInputKey] = useState(0);
  const [editModalMode, setEditModalMode] = useState<"edit" | null>(null);
  const [editingRecordId, setEditingRecordId] = useState<number | string | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, unknown>>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [editSaveError, setEditSaveError] = useState<string | null>(null);
  const [selectedRowIds, setSelectedRowIds] = useState<(number | string)[]>([]);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditColumn, setBulkEditColumn] = useState<string>("");
  const [bulkEditValue, setBulkEditValue] = useState<unknown>(null);
  const [bulkEditSaving, setBulkEditSaving] = useState(false);
  const [bulkEditError, setBulkEditError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [displayedCount, setDisplayedCount] = useState<number | null>(null);
  const [activeFilterCount, setActiveFilterCount] = useState(0);

  const gridApiRef = useRef<import("ag-grid-community").GridApi | null>(null);
  const selectedIdRef = useRef<number | undefined>(selectedId);
  selectedIdRef.current = selectedId;
  const recordsRef = useRef<RecordRead[]>(records);
  recordsRef.current = records;
  const latestRequest = useRef(0);
  const loadedTemplateId = useRef<number | undefined>(undefined);
  const columnsMenuRef = useRef<HTMLDivElement>(null);
  const dataMenuRef = useRef<HTMLDivElement>(null);
  const templateDropdownRef = useRef<HTMLDivElement>(null);
  const [templateDropdownOpen, setTemplateDropdownOpen] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoRef = useRef<{ record: RecordRead; timer: ReturnType<typeof setTimeout> } | null>(null);

  function showToast(message: string, durationMs = 4000) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), durationMs);
  }

  useEffect(() => {
    const handle = setTimeout(() => setQuickFilter(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    function closeMenus(event: MouseEvent) {
      if (columnsMenuRef.current && !columnsMenuRef.current.contains(event.target as Node)) {
        setColumnsMenuOpen(false);
      }
      if (dataMenuRef.current && !dataMenuRef.current.contains(event.target as Node)) {
        setDataMenuOpen(false);
      }
      if (templateDropdownRef.current && !templateDropdownRef.current.contains(event.target as Node)) {
        setTemplateDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", closeMenus);
    return () => document.removeEventListener("mousedown", closeMenus);
  }, []);

  // Reflect the selected template in the URL hash (#/records/7) so
  // refresh and back/forward work -- a plain path segment would collide
  // with /templates and /records, which nginx/vite already proxy to the
  // backend API.
  useEffect(() => {
    if (selectedId == null) return;
    const next = `#/records/${selectedId}`;
    if (window.location.hash !== next) {
      window.history.replaceState(null, "", next);
    }
  }, [selectedId]);

  // Back/forward and a manually-edited hash should also switch templates,
  // not just the initial load -- otherwise the URL and the grid silently
  // drift apart (the hash-sync effect above would then fight back and
  // forth, overwriting the hash with whatever selectedId is stale on).
  useEffect(() => {
    function handleHashChange() {
      const hashMatch = /^#\/records\/(\d+)/.exec(window.location.hash);
      const fromHash = hashMatch ? Number(hashMatch[1]) : undefined;
      if (fromHash != null && fromHash !== selectedIdRef.current) {
        handleSelectTemplate(fromHash);
      }
    }
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    listTemplates()
      .then((result) => {
        if (!Array.isArray(result)) {
          setTemplatesError("Couldn't load your templates. Check your connection and try again.");
          return;
        }
        setTemplates(result);
        const hashMatch = /^#\/records\/(\d+)/.exec(window.location.hash);
        const fromHash = hashMatch ? Number(hashMatch[1]) : undefined;
        setSelectedId((current) => current ?? (result.some((t) => t.id === fromHash) ? fromHash : result[0]?.id));
        result.forEach((t) => {
          listRecords(t.id)
            .then((recs) => setRowCounts((prev) => ({ ...prev, [t.id]: Array.isArray(recs) ? recs.length : 0 })))
            .catch(() => undefined);
        });
      })
      .catch(() => setTemplatesError("Couldn't load your templates. Check your connection and try again."));
  }, []);

  useEffect(() => {
    if (selectedId == null) {
      setTemplate(null);
      return;
    }
    getTemplate(selectedId)
      .then(setTemplate)
      .catch(() => setRecordsError("Couldn't load this template. Check your connection and try again."));
  }, [selectedId]);

  useEffect(() => {
    if (selectedId == null) {
      setRecords([]);
      setInitialLoading(false);
      return;
    }
    const requestId = ++latestRequest.current;
    setInitialLoading(true);
    setRecordsError(null);
    listRecords(selectedId)
      .then((result) => {
        if (requestId !== latestRequest.current) return;
        setRecords(Array.isArray(result) ? result : []);
        loadedTemplateId.current = selectedId;
        setRowCounts((prev) => ({ ...prev, [selectedId]: Array.isArray(result) ? result.length : 0 }));
      })
      .catch(() => {
        if (requestId !== latestRequest.current) return;
        setRecordsError("Couldn't load records. Check your connection and try again.");
      })
      .finally(() => {
        if (requestId === latestRequest.current) setInitialLoading(false);
      });
  }, [selectedId]);

  const rowData = useMemo(() => records.map(flattenRecord), [records]);

  function persistColumnState() {
    if (selectedId == null || !gridApiRef.current) return;
    try {
      const state = gridApiRef.current.getColumnState();
      localStorage.setItem(COLUMN_STATE_PREFIX + selectedId, JSON.stringify(state));
    } catch {
      // localStorage can throw (private mode, quota) -- a per-viewer
      // convenience, never required for the page to work.
    }
  }

  function restoreColumnState() {
    if (selectedId == null || !gridApiRef.current) return;
    try {
      const raw = localStorage.getItem(COLUMN_STATE_PREFIX + selectedId);
      if (raw) {
        gridApiRef.current.applyColumnState({ state: JSON.parse(raw), applyOrder: true });
      }
    } catch {
      // ignore
    }
  }

  function refreshCounters() {
    const api = gridApiRef.current;
    if (!api) return;
    setDisplayedCount(api.getDisplayedRowCount());
    setActiveFilterCount(Object.keys(api.getFilterModel() ?? {}).length);
  }

  async function finalizeOrDiscardTempRow() {
    const api = gridApiRef.current;
    if (!api || api.getEditingCells().length > 0 || !template) return;
    // Reads the ref, not the `records` state this closure was created
    // with -- this runs from a cellEditingStopped event fired on the same
    // row whose own cellValueChanged already updated `records`, and a
    // plain closure over `records` here would still see the pre-edit
    // snapshot from that earlier render.
    const tempRecord = recordsRef.current.find((r) => isTempRowId(r.id));
    if (!tempRecord) return;
    const hasAnyValue = template.columns
      .filter((c) => c.formula == null)
      .some((c) => {
        const v = tempRecord.data[c.name];
        return v != null && v !== "" && v !== defaultDraftValue(c.type);
      });
    if (!hasAnyValue) {
      setRecords((prev) => prev.filter((r) => r.id !== tempRecord.id));
      return;
    }
    try {
      const created = await createRecord(template.id, tempRecord.data);
      setRecords((prev) => prev.map((r) => (r.id === tempRecord.id ? created : r)));
      setRowCounts((prev) => ({ ...prev, [template.id]: (prev[template.id] ?? 0) + 1 }));
    } catch (error) {
      setGridError(error instanceof ApiError ? describeApiError(error) : "Couldn't add this row. Check your connection and try again.");
      setRecords((prev) => prev.filter((r) => r.id !== tempRecord.id));
    }
  }

  async function handleCellValueChanged(event: CellValueChangedEvent) {
    const recordId = event.data.id;
    if (isTempRowId(recordId)) {
      // Held locally in `records` state until the editing session on this
      // row ends -- see finalizeOrDiscardTempRow, triggered by
      // onCellEditingStopped (handleCellEditingStopped below), which fires
      // synchronously right after this, in the same tick, before React
      // has re-rendered. recordsRef is updated here directly (not just
      // via setRecords, which only lands in the ref on the next render)
      // so that finalize sees this edit immediately instead of one edit
      // behind.
      const updated = recordsRef.current.map((r) =>
        r.id === recordId ? { ...r, data: { ...r.data, [event.colDef.field!]: event.newValue } } : r
      );
      recordsRef.current = updated;
      setRecords(updated);
      return;
    }
    const record = records.find((r) => r.id === recordId);
    if (!record) return;
    const field = event.colDef.field!;
    const previousValue = record.data[field];
    const mergedData = { ...record.data, [field]: event.newValue };
    setRecords((prev) => prev.map((r) => (r.id === recordId ? { ...r, data: mergedData } : r)));
    try {
      const updated = await updateRecord(Number(recordId), mergedData);
      setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    } catch (error) {
      setRecords((prev) => prev.map((r) => (r.id === recordId ? { ...r, data: { ...r.data, [field]: previousValue } } : r)));
      showToast(error instanceof ApiError ? describeApiError(error) : "Couldn't save your change. Check your connection and try again.");
    }
  }

  function handleCellEditingStopped(event: CellEditingStoppedEvent) {
    if (!isTempRowId(event.data.id)) return;
    void finalizeOrDiscardTempRow();
  }

  const columnDefs = useMemo<ColDef[]>(() => {
    if (!template) return [];

    // No manual "__select" colDef here: a pinned-left checkbox column
    // (header "select all" + per-row) is rendered entirely by AG-Grid's
    // own row-selection mechanism via the rowSelection prop below.
    // Declaring both at once (this used to also set colDef-level
    // checkboxSelection/headerCheckboxSelection) made the grid render a
    // second, separate "ag-Grid-SelectionColumn" alongside this one.
    const dataColumns: ColDef[] = template.columns
      .filter((col) => !hiddenColumns.has(col.name))
      .map((col, index) => {
        const isFormula = col.formula != null;
        const base: ColDef = {
          field: col.name,
          headerName: (isFormula ? "ƒx  " : "") + columnLabel(col),
          headerTooltip: isFormula ? `Formula: ${col.formula}` : undefined,
          minWidth: 90,
          maxWidth: 360,
          wrapHeaderText: true,
          autoHeaderHeight: true,
          cellDataType: false,
          editable: !isFormula,
          pinned: col.pinned === "left" || (index === 0 && template.columns.length > 8) ? "left" : undefined,
          headerClass: col.type === "number" ? "dv-numeric-header" : undefined,
          cellClass: [
            col.type === "number" ? "dv-numeric" : "",
            isFormula ? "dv-formula-cell" : "",
          ]
            .filter(Boolean)
            .join(" "),
        };
        if (col.width) base.width = col.width;

        if (col.type === "number") {
          return {
            ...base,
            cellRenderer: NumberCell,
            cellRendererParams: { column: col },
            cellEditor: NumberCellEditor,
            filter: "agNumberColumnFilter",
          };
        }
        if (col.type === "date") {
          return {
            ...base,
            cellRenderer: DateCell,
            cellEditor: DateCellEditor,
            filter: "agDateColumnFilter",
          };
        }
        if (col.type === "boolean") {
          return {
            ...base,
            cellRenderer: BooleanCell,
            cellRendererParams: { column: col },
            cellEditor: "agCheckboxCellEditor",
            filter: "agTextColumnFilter",
          };
        }
        if (col.format === "choice" && col.options?.length) {
          // The pill badge needs room for its own padding on top of the
          // text, or the cell clips its rounded end instead of just
          // showing the full word -- size the column for the longest
          // option, not the generic 90px floor every other column uses.
          const longestOption = Math.max(...col.options.map((opt) => opt.length));
          return {
            ...base,
            minWidth: Math.max(base.minWidth as number, longestOption * 8 + 64),
            cellRenderer: ChoiceCell,
            cellRendererParams: { column: col },
            cellEditor: "agSelectCellEditor",
            cellEditorParams: { values: col.options },
            filter: "agTextColumnFilter",
          };
        }
        return {
          ...base,
          cellRenderer: TextCell,
          cellEditor: "agLargeTextCellEditor",
          cellEditorPopup: true,
          cellEditorParams: { rows: 6, cols: 50 },
          filter: "agTextColumnFilter",
          tooltipField: col.name,
        };
      });

    const actionsColumn: ColDef = {
      colId: "__actions",
      headerName: "",
      width: 56,
      minWidth: 56,
      maxWidth: 56,
      pinned: "right",
      editable: false,
      sortable: false,
      filter: false,
      resizable: false,
      suppressHeaderMenuButton: true,
      cellDataType: false,
      cellRenderer: RowActionsCell,
      cellRendererParams: {
        onEditForm: handleOpenEdit,
        onDuplicate: handleDuplicateRow,
        onDelete: handleDeleteRow,
      },
    };
    return [...dataColumns, actionsColumn];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, hiddenColumns, records]);

  const pinnedBottomRowData = useMemo(() => {
    if (!template || records.length === 0) return undefined;
    const summaryRow: Record<string, unknown> = { id: "__summary" };
    template.columns.forEach((col) => {
      if (isSummableFormat(col)) {
        const total = records.reduce((sum, r) => {
          const v = col.formula != null ? r.computed[col.name] : r.data[col.name];
          return typeof v === "number" ? sum + v : sum;
        }, 0);
        summaryRow[col.name] = total;
      }
    });
    return [summaryRow];
  }, [template, records]);

  const defaultColDef = useMemo<ColDef>(
    () => ({
      resizable: true,
      sortable: true,
    }),
    []
  );

  const columnsReady = template != null && template.id === selectedId;
  const showFullLoading = selectedId != null && (initialLoading || !columnsReady);

  function handleSelectTemplate(id: number) {
    setSelectedId(id);
    setTemplateDropdownOpen(false);
    setSearchInput("");
    setGridError(null);
    setExportError(null);
    setImportError(null);
    setImportResult(null);
    setHiddenColumns(new Set());
    setSelectedRowIds([]);
    setColumnsMenuOpen(false);
  }

  function toggleColumnVisibility(fieldName: string) {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(fieldName)) next.delete(fieldName);
      else next.add(fieldName);
      return next;
    });
  }

  function handleOpenEdit(recordId: number | string) {
    const record = records.find((r) => r.id === recordId);
    if (!record || !template) return;
    const draft: Record<string, unknown> = {};
    for (const column of template.columns) {
      if (column.formula == null) draft[column.name] = record.data[column.name] ?? null;
    }
    setEditModalMode("edit");
    setEditingRecordId(recordId);
    setEditDraft(draft);
    setEditSaveError(null);
  }

  function handleAddRow() {
    if (!template || selectedId == null) return;
    const draft: Record<string, unknown> = {};
    for (const column of template.columns) {
      if (column.formula == null) draft[column.name] = defaultDraftValue(column.type);
    }
    const tempId = `${TEMP_ROW_PREFIX}${Date.now()}`;
    const tempRecord: RecordRead = {
      id: tempId as unknown as number,
      template_id: template.id,
      data: draft,
      computed: {},
      created_at: "",
      updated_at: "",
    };
    setRecords((prev) => [tempRecord, ...prev]);
    window.setTimeout(() => {
      const api = gridApiRef.current;
      if (!api || !template) return;
      const firstEditable = template.columns.find((c) => c.formula == null);
      if (firstEditable) {
        api.ensureIndexVisible(0);
        api.startEditingCell({ rowIndex: 0, colKey: firstEditable.name });
      }
    }, 0);
  }

  function handleDuplicateRow(recordId: number | string) {
    const record = records.find((r) => r.id === recordId);
    if (!record || !template) return;
    createRecord(template.id, record.data)
      .then((created) => {
        setRecords((prev) => [created, ...prev]);
        setRowCounts((prev) => ({ ...prev, [template.id]: (prev[template.id] ?? 0) + 1 }));
      })
      .catch((error) => setGridError(error instanceof ApiError ? describeApiError(error) : "Couldn't duplicate this row."));
  }

  function handleDeleteRow(recordId: number | string) {
    const record = records.find((r) => r.id === recordId);
    if (!record) return;
    setGridError(null);
    setRecords((prev) => prev.filter((r) => r.id !== recordId));
    deleteRecord(Number(recordId))
      .then(() => {
        if (template) setRowCounts((prev) => ({ ...prev, [template.id]: Math.max(0, (prev[template.id] ?? 1) - 1) }));
        if (undoRef.current) clearTimeout(undoRef.current.timer);
        const timer = setTimeout(() => {
          undoRef.current = null;
        }, 6000);
        undoRef.current = { record, timer };
        showToast("Row deleted · Undo", 6000);
      })
      .catch(() => {
        setRecords((prev) => [record, ...prev]);
        setGridError("Couldn't delete this row. Check your connection and try again.");
      });
  }

  function handleUndoDelete() {
    if (!undoRef.current || !template) return;
    const { record } = undoRef.current;
    clearTimeout(undoRef.current.timer);
    undoRef.current = null;
    createRecord(template.id, record.data)
      .then((created) => {
        setRecords((prev) => [created, ...prev]);
        setRowCounts((prev) => ({ ...prev, [template.id]: (prev[template.id] ?? 0) + 1 }));
        setToast(null);
      })
      .catch(() => setGridError("Couldn't restore this row."));
  }

  function handleCloseEdit() {
    setEditModalMode(null);
  }

  function handleEditFieldChange(fieldName: string, value: unknown) {
    setEditDraft((prev) => ({ ...prev, [fieldName]: value }));
  }

  async function handleSaveEdit() {
    if (!template || editingRecordId == null) return;
    const record = records.find((r) => r.id === editingRecordId);
    if (!record) return;
    setSavingEdit(true);
    setEditSaveError(null);
    try {
      const updated = await updateRecord(Number(editingRecordId), { ...record.data, ...editDraft });
      setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setEditModalMode(null);
    } catch (error) {
      setEditSaveError(
        error instanceof ApiError ? describeApiError(error) : "Couldn't save your change. Check your connection and try again."
      );
    } finally {
      setSavingEdit(false);
    }
  }

  function handleEditDialogKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") handleCloseEdit();
  }

  async function handleExport() {
    if (selectedId == null || !template) return;
    setExporting(true);
    setExportError(null);
    try {
      const blob = await exportTemplate(selectedId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${template.name}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error instanceof ApiError ? describeApiError(error) : "Couldn't export this template. Check your connection and try again.");
    } finally {
      setExporting(false);
    }
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || selectedId == null) return;
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const result = await importTemplate(selectedId, file);
      setImportResult(result);
      const refreshed = await listRecords(selectedId);
      setRecords(Array.isArray(refreshed) ? refreshed : []);
      setRowCounts((prev) => ({ ...prev, [selectedId]: Array.isArray(refreshed) ? refreshed.length : 0 }));
    } catch (error) {
      setImportError(error instanceof ApiError ? describeApiError(error) : "Couldn't import this file. Check your connection and try again.");
    } finally {
      setImporting(false);
      setImportInputKey((k) => k + 1);
    }
  }

  async function handleCreateFromExcel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const name = newTemplateName.trim();
    if (!file) return;
    if (!name) {
      setCreateFromExcelError("Enter a template name first.");
      setCreateFromExcelInputKey((k) => k + 1);
      return;
    }
    setCreatingFromExcel(true);
    setCreateFromExcelError(null);
    try {
      const { template: created, import_result } = await createTemplateFromExcel(name, file);
      setTemplates((prev) => [...prev, created]);
      setRowCounts((prev) => ({ ...prev, [created.id]: import_result.imported_count }));
      setNewTemplateName("");
      setNewTemplateDialogOpen(false);
      handleSelectTemplate(created.id);
      setImportResult(import_result);
    } catch (error) {
      setCreateFromExcelError(
        error instanceof ApiError ? describeApiError(error) : "Couldn't create a template from this file. Check your connection and try again."
      );
    } finally {
      setCreatingFromExcel(false);
      setCreateFromExcelInputKey((k) => k + 1);
    }
  }

  function openBulkEdit() {
    if (!template) return;
    const firstEditable = template.columns.find((c) => c.formula == null);
    setBulkEditColumn(firstEditable?.name ?? "");
    setBulkEditValue(firstEditable ? defaultDraftValue(firstEditable.type) : null);
    setBulkEditError(null);
    setBulkEditOpen(true);
  }

  async function handleApplyBulkEdit() {
    if (!bulkEditColumn || selectedRowIds.length === 0) return;
    setBulkEditSaving(true);
    setBulkEditError(null);
    let successCount = 0;
    const errors: string[] = [];
    for (const id of selectedRowIds) {
      const record = records.find((r) => r.id === id);
      if (!record) continue;
      try {
        const updated = await updateRecord(Number(id), { ...record.data, [bulkEditColumn]: bulkEditValue });
        setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        successCount += 1;
      } catch {
        errors.push(String(id));
      }
    }
    setBulkEditSaving(false);
    if (errors.length > 0) {
      setBulkEditError(`Updated ${successCount} of ${selectedRowIds.length} rows. ${errors.length} failed.`);
    } else {
      setBulkEditOpen(false);
      showToast(`Updated ${successCount} row${successCount === 1 ? "" : "s"}.`);
      setSelectedRowIds([]);
      gridApiRef.current?.deselectAll();
    }
  }

  function handleBulkDelete() {
    if (selectedRowIds.length === 0) return;
    const confirmed = window.confirm(`Delete ${selectedRowIds.length} selected row${selectedRowIds.length === 1 ? "" : "s"}? This can't be undone.`);
    if (!confirmed) return;
    const ids = [...selectedRowIds];
    setRecords((prev) => prev.filter((r) => !ids.includes(r.id)));
    setSelectedRowIds([]);
    gridApiRef.current?.deselectAll();
    Promise.allSettled(ids.map((id) => deleteRecord(Number(id)))).then((results) => {
      const failed = results.filter((r) => r.status === "rejected").length;
      if (template) setRowCounts((prev) => ({ ...prev, [template.id]: Math.max(0, (prev[template.id] ?? ids.length) - (ids.length - failed)) }));
      if (failed > 0) setGridError(`${failed} row(s) couldn't be deleted. Reload to check.`);
      else showToast(`Deleted ${ids.length} row${ids.length === 1 ? "" : "s"}.`);
    });
  }

  const visibleColumnCount = template?.columns.length ?? 0;
  const filteredColumnsForMenu = template
    ? template.columns.filter((c) => columnLabel(c).toLowerCase().includes(columnsMenuFilter.toLowerCase()))
    : [];

  const bulkEditTargetColumn = template?.columns.find((c) => c.name === bulkEditColumn) ?? null;

  return (
    <div className="dv-page">
      <div className="dv-topbar">
        <div className="dv-title-group">
          <h2>{template ? template.name : "Records"}</h2>
          {template ? <span className="dv-row-count">· {rowCounts[template.id] ?? records.length} rows</span> : null}
        </div>
        <div className="dv-topbar-right">
          <div className="dv-template-dropdown" ref={templateDropdownRef}>
            <button
              type="button"
              className="dv-toolbar-button dv-template-dropdown-button"
              onClick={() => setTemplateDropdownOpen((o) => !o)}
              aria-expanded={templateDropdownOpen}
              aria-haspopup="listbox"
            >
              <span className="dv-template-dropdown-button-label">{template ? template.name : "Select a template"}</span>
              <span className="dv-template-dropdown-button-chevron" aria-hidden="true">▾</span>
            </button>
            {templateDropdownOpen ? (
              <div className="dv-template-dropdown-panel" role="listbox">
                {templates.map((t) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedId === t.id}
                    key={t.id}
                    className="dv-template-dropdown-item"
                    onClick={() => handleSelectTemplate(t.id)}
                  >
                    <span>{t.name}</span>
                    <span className="dv-template-dropdown-count">{rowCounts[t.id] ?? 0} rows</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button type="button" className="dv-toolbar-button dv-new-button" onClick={() => setNewTemplateDialogOpen(true)}>
            + New
          </button>
        </div>
      </div>

      {templatesError ? <p className="dv-error">{templatesError}</p> : null}

      <div className="dv-toolbar">
        <label className="dv-search">
          <span className="dv-search-label">Search</span>
          <input
            type="search"
            placeholder="Search records…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          {searchInput ? (
            <button type="button" className="dv-search-clear" aria-label="Clear search" onClick={() => setSearchInput("")}>
              ×
            </button>
          ) : null}
        </label>
        {displayedCount != null ? (
          <span className="dv-row-count-chip">
            {displayedCount} of {records.length} rows
          </span>
        ) : null}
        {activeFilterCount > 0 ? (
          <button
            type="button"
            className="dv-filter-chip"
            onClick={() => {
              gridApiRef.current?.setFilterModel(null);
              refreshCounters();
            }}
          >
            {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} active · Clear all
          </button>
        ) : null}

        <div className="dv-toolbar-spacer" />

        {selectedRowIds.length === 0 ? <div className="dv-toolbar-divider" aria-hidden="true" /> : null}

        {selectedRowIds.length > 0 ? (
          <div className="dv-bulk-bar">
            <span>{selectedRowIds.length} selected</span>
            <button type="button" className="dv-toolbar-button" onClick={openBulkEdit}>
              Edit selected
            </button>
            <button type="button" className="dv-toolbar-button dv-bulk-delete" onClick={handleBulkDelete}>
              Delete selected
            </button>
            <button
              type="button"
              className="dv-toolbar-button"
              onClick={() => {
                setSelectedRowIds([]);
                gridApiRef.current?.deselectAll();
              }}
            >
              Clear selection
            </button>
          </div>
        ) : null}

        {template && visibleColumnCount > 0 ? (
          <div className="dv-columns-menu" ref={columnsMenuRef}>
            <button
              type="button"
              className="dv-toolbar-button"
              onClick={() => setColumnsMenuOpen((open) => !open)}
              aria-expanded={columnsMenuOpen}
            >
              Columns{hiddenColumns.size > 0 ? ` (${hiddenColumns.size} hidden)` : ""}
            </button>
            {columnsMenuOpen ? (
              <div className="dv-columns-panel" role="menu">
                {visibleColumnCount > 10 ? (
                  <input
                    type="text"
                    className="dv-columns-search"
                    placeholder="Search columns…"
                    value={columnsMenuFilter}
                    onChange={(e) => setColumnsMenuFilter(e.target.value)}
                    autoFocus
                  />
                ) : null}
                <div className="dv-columns-panel-actions">
                  <button type="button" onClick={() => setHiddenColumns(new Set())}>
                    Show all
                  </button>
                  <button type="button" onClick={() => setHiddenColumns(new Set(template.columns.map((c) => c.name)))}>
                    Hide all
                  </button>
                </div>
                {filteredColumnsForMenu.map((col) => (
                  <label key={col.name} className="dv-columns-panel-item">
                    <input
                      type="checkbox"
                      checked={!hiddenColumns.has(col.name)}
                      onChange={() => toggleColumnVisibility(col.name)}
                    />
                    {columnLabel(col)}
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="dv-data-menu" ref={dataMenuRef}>
          <button
            type="button"
            className="dv-toolbar-button"
            onClick={() => setDataMenuOpen((o) => !o)}
            aria-expanded={dataMenuOpen}
          >
            Data ▾
          </button>
          {dataMenuOpen ? (
            <div className="dv-data-menu-panel" role="menu">
              <button type="button" onClick={() => { setDataMenuOpen(false); handleExport(); }} disabled={selectedId == null || exporting}>
                {exporting ? "Exporting…" : "Export"}
              </button>
              <label className="dv-data-menu-import">
                {importing ? "Importing…" : "Import"}
                <input
                  key={importInputKey}
                  type="file"
                  accept=".xlsx"
                  className="dv-import-input"
                  onChange={(e) => { setDataMenuOpen(false); handleImportFile(e); }}
                  disabled={selectedId == null || importing}
                />
              </label>
            </div>
          ) : null}
        </div>

        <button type="button" className="dv-add-row-primary" onClick={handleAddRow} disabled={selectedId == null}>
          + Add row
        </button>
      </div>

      {recordsError ? <p className="dv-error">{recordsError}</p> : null}
      {gridError ? <p className="dv-error">{gridError}</p> : null}
      {exportError ? <p className="dv-error">{exportError}</p> : null}
      {importError ? <p className="dv-error">{importError}</p> : null}

      {importResult ? (
        importResult.errors.some((error) => error.row_number === 0) ? (
          <div className="dv-import-errors" role="alert">
            <p>Nothing was imported: {importResult.errors[0].reason}</p>
          </div>
        ) : importResult.errors.length > 0 ? (
          <div className="dv-import-errors" role="alert">
            <p>
              {importResult.imported_count} row{importResult.imported_count === 1 ? "" : "s"} imported.{" "}
              {importResult.errors.length} row{importResult.errors.length === 1 ? "" : "s"} had problems:
            </p>
            <ul>
              {importResult.errors.map((error, i) => (
                <li key={i}>{describeImportError(error)}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p role="status" className="dv-import-success">
            Imported {importResult.imported_count} row{importResult.imported_count === 1 ? "" : "s"}.
          </p>
        )
      ) : null}

      <div className="dv-grid-area">
        {selectedId == null ? (
          <p className="dv-empty">Select a template to view its records.</p>
        ) : showFullLoading ? (
          <div className="dv-skeleton" role="status" aria-label="Loading records">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="dv-skeleton-row" />
            ))}
          </div>
        ) : records.length === 0 ? (
          <div className="dv-empty-state">
            <p>No rows yet</p>
            <div className="dv-empty-state-actions">
              <button type="button" className="dv-toolbar-button" onClick={handleAddRow}>
                Add row
              </button>
              <label className="dv-empty-state-import">
                Import from Excel
                <input key={importInputKey} type="file" accept=".xlsx" className="dv-import-input" onChange={handleImportFile} />
              </label>
            </div>
          </div>
        ) : (
          <div className="dv-grid">
            <AgGridReact
              theme={theme === "dark" ? gridThemeDark : gridThemeLight}
              rowData={rowData}
              columnDefs={columnDefs}
              defaultColDef={defaultColDef}
              pinnedBottomRowData={pinnedBottomRowData}
              getRowId={(params) => String(params.data.id)}
              rowSelection={{ mode: "multiRow", checkboxes: true, headerCheckbox: true }}
              selectionColumnDef={{
                pinned: "left",
                width: 44,
                minWidth: 44,
                maxWidth: 44,
                resizable: false,
                sortable: false,
                suppressHeaderMenuButton: true,
              }}
              suppressRowClickSelection
              quickFilterText={quickFilter}
              debounceVerticalScrollbar
              animateRows
              onGridReady={(event) => {
                gridApiRef.current = event.api;
                restoreColumnState();
                refreshCounters();
              }}
              onFirstDataRendered={() => refreshCounters()}
              onModelUpdated={() => refreshCounters()}
              onSelectionChanged={(event) => setSelectedRowIds(event.api.getSelectedRows().map((r) => r.id))}
              onCellValueChanged={handleCellValueChanged}
              onCellEditingStopped={handleCellEditingStopped}
              onColumnMoved={persistColumnState}
              onColumnResized={(e) => { if (e.finished) persistColumnState(); }}
              onColumnVisible={persistColumnState}
              onSortChanged={persistColumnState}
              onFilterChanged={refreshCounters}
              noRowsOverlayComponent={() => (
                <div className="dv-empty-state">
                  <p>No rows match "{searchInput}"</p>
                  <button type="button" className="dv-toolbar-button" onClick={() => setSearchInput("")}>
                    Clear search
                  </button>
                </div>
              )}
            />
          </div>
        )}
      </div>

      {editModalMode && template && editingRecordId != null ? (
        <div className="dv-overlay" onKeyDown={handleEditDialogKeyDown}>
          <div className="dv-dialog" role="dialog" aria-modal="true" aria-labelledby="dv-edit-title">
            <div className="dv-dialog-header">
              <h2 id="dv-edit-title">Edit row</h2>
              <button type="button" className="dv-close-edit" onClick={handleCloseEdit} disabled={savingEdit} aria-label="Close">
                ×
              </button>
            </div>
            <div className="dv-edit-fields">
              {template.columns.map((col) => {
                const isFormula = col.formula != null;
                const record = records.find((r) => r.id === editingRecordId);
                return (
                  <label key={col.name} className="dv-field">
                    <span className="dv-search-label">{columnLabel(col)}</span>
                    {isFormula ? (
                      <input type="text" readOnly value={record ? String(record.computed[col.name] ?? "") : ""} className="dv-field-readonly" />
                    ) : col.type === "boolean" ? (
                      <input
                        type="checkbox"
                        checked={Boolean(editDraft[col.name])}
                        onChange={(e) => handleEditFieldChange(col.name, e.target.checked)}
                      />
                    ) : col.type === "number" ? (
                      <input
                        type="number"
                        value={editDraft[col.name] == null ? "" : String(editDraft[col.name])}
                        onChange={(e) => handleEditFieldChange(col.name, e.target.value === "" ? null : Number(e.target.value))}
                      />
                    ) : col.type === "date" ? (
                      <DateInput
                        value={(editDraft[col.name] as string) ?? null}
                        onChange={(iso) => handleEditFieldChange(col.name, iso)}
                      />
                    ) : col.format === "choice" && col.options?.length ? (
                      <select value={String(editDraft[col.name] ?? "")} onChange={(e) => handleEditFieldChange(col.name, e.target.value)}>
                        <option value="" />
                        {col.options.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <textarea
                        rows={3}
                        value={editDraft[col.name] == null ? "" : String(editDraft[col.name])}
                        onChange={(e) => handleEditFieldChange(col.name, e.target.value)}
                      />
                    )}
                  </label>
                );
              })}
            </div>
            {editSaveError ? <p className="dv-error">{editSaveError}</p> : null}
            <div className="dv-dialog-actions">
              <button type="button" className="dv-cancel-edit" onClick={handleCloseEdit} disabled={savingEdit}>
                Cancel
              </button>
              <button type="button" className="dv-save-edit" onClick={handleSaveEdit} disabled={savingEdit}>
                {savingEdit ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {bulkEditOpen && template ? (
        <div className="dv-overlay" onKeyDown={(e) => { if (e.key === "Escape") setBulkEditOpen(false); }}>
          <div className="dv-dialog dv-bulk-dialog" role="dialog" aria-modal="true" aria-labelledby="dv-bulk-title">
            <h2 id="dv-bulk-title">Edit {selectedRowIds.length} rows</h2>
            <label className="dv-field">
              <span className="dv-search-label">Column</span>
              <select
                value={bulkEditColumn}
                onChange={(e) => {
                  const col = template.columns.find((c) => c.name === e.target.value);
                  setBulkEditColumn(e.target.value);
                  setBulkEditValue(col ? defaultDraftValue(col.type) : null);
                }}
              >
                {template.columns
                  .filter((c) => c.formula == null)
                  .map((c) => (
                    <option key={c.name} value={c.name}>
                      {columnLabel(c)}
                    </option>
                  ))}
              </select>
            </label>
            <label className="dv-field">
              <span className="dv-search-label">New value</span>
              {bulkEditTargetColumn?.type === "boolean" ? (
                <input type="checkbox" checked={Boolean(bulkEditValue)} onChange={(e) => setBulkEditValue(e.target.checked)} />
              ) : bulkEditTargetColumn?.type === "number" ? (
                <input
                  type="number"
                  value={bulkEditValue == null ? "" : String(bulkEditValue)}
                  onChange={(e) => setBulkEditValue(e.target.value === "" ? null : Number(e.target.value))}
                />
              ) : bulkEditTargetColumn?.type === "date" ? (
                <DateInput value={(bulkEditValue as string) ?? null} onChange={setBulkEditValue} />
              ) : bulkEditTargetColumn?.format === "choice" && bulkEditTargetColumn.options?.length ? (
                <select value={String(bulkEditValue ?? "")} onChange={(e) => setBulkEditValue(e.target.value)}>
                  <option value="" />
                  {bulkEditTargetColumn.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input type="text" value={bulkEditValue == null ? "" : String(bulkEditValue)} onChange={(e) => setBulkEditValue(e.target.value)} />
              )}
            </label>
            {bulkEditError ? <p className="dv-error">{bulkEditError}</p> : null}
            <div className="dv-dialog-actions">
              <button type="button" className="dv-cancel-edit" onClick={() => setBulkEditOpen(false)} disabled={bulkEditSaving}>
                Cancel
              </button>
              <button type="button" className="dv-save-edit" onClick={handleApplyBulkEdit} disabled={bulkEditSaving}>
                {bulkEditSaving ? "Applying…" : `Apply to ${selectedRowIds.length} rows`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {newTemplateDialogOpen ? (
        <div className="dv-overlay" onKeyDown={(e) => { if (e.key === "Escape") setNewTemplateDialogOpen(false); }}>
          <div className="dv-dialog" role="dialog" aria-modal="true" aria-labelledby="dv-new-title">
            <div className="dv-dialog-header">
              <h2 id="dv-new-title">New template</h2>
              <button type="button" className="dv-close-edit" onClick={() => setNewTemplateDialogOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            <label className="dv-field">
              <span className="dv-search-label">Template name</span>
              <input
                type="text"
                placeholder="e.g. Timesheet"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                disabled={creatingFromExcel}
              />
            </label>
            {createFromExcelError ? <p className="dv-error">{createFromExcelError}</p> : null}
            <div className="dv-dialog-actions">
              <button
                type="button"
                className="dv-cancel-edit"
                onClick={() => {
                  setNewTemplateDialogOpen(false);
                  window.location.hash = "#/templates";
                }}
              >
                Start blank
              </button>
              <label className="dv-save-edit dv-import-label">
                {creatingFromExcel ? "Creating…" : "Import from Excel"}
                <input
                  key={createFromExcelInputKey}
                  type="file"
                  accept=".xlsx"
                  className="dv-import-input"
                  onChange={handleCreateFromExcel}
                  disabled={creatingFromExcel}
                />
              </label>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="dv-toast" role="status">
          {toast}
          {toast.includes("Undo") ? (
            <button type="button" className="dv-toast-undo" onClick={handleUndoDelete}>
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
