import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { AgGridReact } from "ag-grid-react";
import { ModuleRegistry, AllCommunityModule, themeQuartz } from "ag-grid-community";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
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
import "./DataViewPage.css";

ModuleRegistry.registerModules([AllCommunityModule]);

const SEARCH_DEBOUNCE_MS = 250;

/*
 * Design direction (frontend-design skill, invoked for this page's own
 * states — grid, search, loading, empty, error — within the greenbar
 * system TemplateBuilderPage established): this page reuses every color
 * and type token from src/styles/tokens.css verbatim; no new palette or
 * typeface decision is made here. The left-rail template index and
 * main-panel surface are the same structure as TemplateBuilderPage.tsx
 * (see DataViewPage.css). AG-Grid is the one new visual element, themed
 * via the Theming API below so it reads as the same ledger's "sheet"
 * sunk into the main panel, not a bolted-on default-blue widget.
 *
 * The values below are copied from tokens.css and each is labeled with
 * the custom property it mirrors. I tried passing `var(--token)`
 * references directly (so the grid would read the same CSS custom
 * properties at paint time instead of duplicating hex), but AG-Grid's
 * Theming API injects its generated CSS via a mechanism (constructable
 * stylesheets / an in-memory <style> tag written through APIs jsdom
 * doesn't fully implement) that never ran in this project's jsdom test
 * environment — zero <style> tags and zero `document.adoptedStyleSheets`
 * entries after render, verified directly. With no browser available in
 * this environment either, there was no way to confirm `var()` refs
 * survive into the real injected CSS, and if AG-Grid's internal color
 * math (e.g. deriving hover/selection tints) expects a parseable hex
 * string, a `var()` reference could silently break it. Falling back to
 * the proven, documented literal-value usage below rather than shipping
 * something unverifiable. Keep these in sync if tokens.css changes.
 */
const gridTheme = themeQuartz.withParams({
  accentColor: "#3c6e53", // --accent
  backgroundColor: "#ffffff", // --surface
  foregroundColor: "#202b23", // --ink
  headerBackgroundColor: "#e3ead9", // --paper-band
  headerTextColor: "#202b23", // --ink
  headerFontWeight: 600,
  oddRowBackgroundColor: "#e3ead9", // --paper-band — the greenbar row stripe
  borderColor: "#b7c4ac", // --rule
  wrapperBorder: { color: "#b7c4ac" }, // --rule
  wrapperBorderRadius: 7, // --radius
  cellTextColor: "#202b23", // --ink
  fontFamily: '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', // --font-body
  cellFontFamily: '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', // --font-body
  headerFontFamily: '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', // --font-body
  spacing: 8, // --space-2
});

interface DataViewPageProps {
  templateId?: number;
}

/** Plain-language display text for a cell value. Booleans read as
 *  "Yes"/"No" (matching TemplateBuilderPage's COLUMN_TYPE_LABELS rule
 *  that raw backend vocabulary like "boolean"/`true` never reaches the
 *  non-technical user). */
function formatValue(value: unknown, columnType: TemplateColumn["type"] | undefined): string {
  if (value == null) {
    return "";
  }
  if (columnType === "boolean" && typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return String(value);
}

/** Cell renderer used for every column: marks a "#VALUE!" formula result
 *  as a visible, explained error instead of rendering it as plain text. */
function ValueCell(params: ICellRendererParams & { columnType?: TemplateColumn["type"] }) {
  const text = formatValue(params.value, params.columnType);
  const isError = text === "#VALUE!";
  return (
    <span
      className={isError ? "dv-cell-error" : undefined}
      data-error={isError ? "true" : undefined}
      title={isError ? "This formula couldn't be calculated for this row." : undefined}
    >
      {text}
    </span>
  );
}

/** Merges a record's raw and computed fields into one flat row keyed by
 *  column name, which is what AG-Grid's columnDefs (built from the
 *  template's column list) expect. */
function flattenRecord(record: RecordRead): Record<string, unknown> {
  return { id: record.id, ...record.data, ...record.computed };
}

/** Turns an ApiError's body into a message a non-technical user can read.
 *  Mirrors TemplateBuilderPage's describeApiError (kept local rather than
 *  shared, since this is the only other call site and the two pages don't
 *  otherwise share a module). */
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

/** Plain-language text for one per-row import error. (A row_number of 0 —
 *  a whole-file problem, not a specific row — is handled separately in
 *  the render below, before this is ever called.) */
function describeImportError(error: { row_number: number; reason: string }): string {
  return `Row ${error.row_number}: ${error.reason}`;
}

/** Button cell renderer for the grid's trailing actions column: an
 *  explicit Edit affordance (click-to-edit has no visual cue of its own,
 *  so this gives every row a visible way in) plus the existing Delete. */
function RowActionsCell(
  params: ICellRendererParams & { onDelete?: (id: number) => void; onEdit?: (id: number) => void }
) {
  return (
    <span className="dv-row-actions">
      <button
        type="button"
        className="dv-edit-row"
        aria-label={`Edit row ${params.data.id}`}
        onClick={() => params.onEdit?.(Number(params.data.id))}
      >
        Edit
      </button>
      <button
        type="button"
        className="dv-delete-row"
        aria-label={`Delete row ${params.data.id}`}
        onClick={() => params.onDelete?.(Number(params.data.id))}
      >
        Delete
      </button>
    </span>
  );
}

export function DataViewPage({ templateId }: DataViewPageProps) {
  const [templates, setTemplates] = useState<TemplateRead[]>([]);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | undefined>(templateId);
  const [template, setTemplate] = useState<TemplateRead | null>(null);
  const [records, setRecords] = useState<RecordRead[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const [searching, setSearching] = useState(false);
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
  const [newTemplateName, setNewTemplateName] = useState("");
  const [creatingFromExcel, setCreatingFromExcel] = useState(false);
  const [createFromExcelError, setCreateFromExcelError] = useState<string | null>(null);
  const [createFromExcelInputKey, setCreateFromExcelInputKey] = useState(0);
  const [editModalMode, setEditModalMode] = useState<"edit" | "create" | null>(null);
  const [editingRecordId, setEditingRecordId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, unknown>>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [editSaveError, setEditSaveError] = useState<string | null>(null);

  const latestRequest = useRef(0);
  const loadedTemplateId = useRef<number | undefined>(undefined);
  const columnsMenuRef = useRef<HTMLDivElement>(null);

  // Close the "Columns" visibility menu on an outside click, like any
  // normal dropdown — without this it would stay open until another
  // button happened to toggle it shut.
  useEffect(() => {
    if (!columnsMenuOpen) {
      return;
    }
    function handleOutsideClick(event: MouseEvent) {
      if (columnsMenuRef.current && !columnsMenuRef.current.contains(event.target as Node)) {
        setColumnsMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [columnsMenuOpen]);

  useEffect(() => {
    listTemplates()
      .then((result) => {
        if (!Array.isArray(result)) {
          setTemplatesError("Couldn't load your templates. Check your connection and try again.");
          return;
        }
        setTemplates(result);
        setSelectedId((current) => current ?? result[0]?.id);
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

  // Debounce typed search input before it drives a fetch, so each
  // keystroke doesn't fire its own request.
  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    if (selectedId == null) {
      setRecords([]);
      setInitialLoading(false);
      setSearching(false);
      return;
    }
    const requestId = ++latestRequest.current;
    const isFirstLoadForTemplate = loadedTemplateId.current !== selectedId;
    if (isFirstLoadForTemplate) {
      setInitialLoading(true);
    } else {
      setSearching(true);
    }
    setRecordsError(null);
    listRecords(selectedId, search || undefined)
      .then((result) => {
        if (requestId !== latestRequest.current) {
          return;
        }
        setRecords(Array.isArray(result) ? result : []);
        loadedTemplateId.current = selectedId;
      })
      .catch(() => {
        if (requestId !== latestRequest.current) {
          return;
        }
        setRecordsError("Couldn't load records. Check your connection and try again.");
      })
      .finally(() => {
        if (requestId === latestRequest.current) {
          setInitialLoading(false);
          setSearching(false);
        }
      });
  }, [selectedId, search]);

  const rowData = useMemo(() => records.map(flattenRecord), [records]);

  const columnDefs = useMemo<ColDef[]>(() => {
    if (!template) {
      return [];
    }
    const dataColumns: ColDef[] = template.columns
      .filter((col) => !hiddenColumns.has(col.name))
      .map((col) => ({
        field: col.name,
        headerName: col.name,
        flex: 1,
        minWidth: 120,
        // Disable AG-Grid's automatic value-based cell data typing (which
        // otherwise swaps in its own built-in checkbox renderer for
        // boolean values), so every column uniformly goes through
        // ValueCell below.
        cellDataType: false,
        cellClass: col.type === "number" ? "dv-numeric" : undefined,
        cellRendererParams: { columnType: col.type },
        // The grid is read-only display; all editing goes through the
        // Edit button's modal form (see RowActionsCell/handleOpenEdit) —
        // a deliberate action, not a click/double-click on a cell that's
        // easy to trigger by accident, and one place to edit every field
        // regardless of how many columns are scrolled off-screen.
        editable: false,
      }));
    const actionsColumn: ColDef = {
      colId: "__actions",
      headerName: "",
      // No fixed width — sized to its actual rendered content (the two
      // buttons) via autoSizeColumns below, instead of a guessed pixel
      // value that would be wrong for different label lengths/locales.
      suppressSizeToFit: true,
      pinned: "right",
      editable: false,
      sortable: false,
      filter: false,
      cellDataType: false,
      cellRenderer: RowActionsCell,
      cellRendererParams: { onDelete: handleDeleteRow, onEdit: handleOpenEdit },
    };
    return [...dataColumns, actionsColumn];
  }, [template, hiddenColumns]);

  const defaultColDef = useMemo<ColDef>(() => ({ cellRenderer: ValueCell }), []);

  // The template on hand must match the currently selected template
  // before the grid is safe to show — otherwise a records response for
  // a new template could render against the previous template's columns
  // for a moment while both fetches are in flight.
  const columnsReady = template != null && template.id === selectedId;
  const showFullLoading = selectedId != null && (initialLoading || !columnsReady);

  function handleSelect(id: number) {
    setSelectedId(id);
    setSearchInput("");
    setSearch("");
    setGridError(null);
    setExportError(null);
    setImportError(null);
    setImportResult(null);
    setHiddenColumns(new Set());
    setColumnsMenuOpen(false);
  }

  function toggleColumnVisibility(fieldName: string) {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(fieldName)) {
        next.delete(fieldName);
      } else {
        next.add(fieldName);
      }
      return next;
    });
  }

  /** Default value for a blank "Add row" draft, per column type — a
   *  checkbox needs a real boolean to render, everything else is fine
   *  starting empty/null. */
  function defaultDraftValue(columnType: TemplateColumn["type"]): unknown {
    return columnType === "boolean" ? false : null;
  }

  /** Opens the edit form for one existing row, seeded with its current
   *  raw values (formula columns are never editable, so they're left out
   *  of the draft entirely). */
  function handleOpenEdit(recordId: number) {
    const record = records.find((r) => r.id === recordId);
    if (!record || !template) {
      return;
    }
    const draft: Record<string, unknown> = {};
    for (const column of template.columns) {
      if (column.formula == null) {
        draft[column.name] = record.data[column.name] ?? null;
      }
    }
    setEditModalMode("edit");
    setEditingRecordId(recordId);
    setEditDraft(draft);
    setEditSaveError(null);
  }

  /** Opens the same form for a brand-new row — "Add row" benefits from
   *  the same full-fields popup as editing, instead of silently creating
   *  an empty record and leaving every field blank until a separate Edit
   *  click. Nothing is created on the backend until Save. */
  function handleOpenAddRow() {
    if (selectedId == null || !template) {
      return;
    }
    const draft: Record<string, unknown> = {};
    for (const column of template.columns) {
      if (column.formula == null) {
        draft[column.name] = defaultDraftValue(column.type);
      }
    }
    setEditModalMode("create");
    setEditingRecordId(null);
    setEditDraft(draft);
    setEditSaveError(null);
  }

  function handleCloseEdit() {
    setEditModalMode(null);
  }

  function handleEditFieldChange(fieldName: string, value: unknown) {
    setEditDraft((prev) => ({ ...prev, [fieldName]: value }));
  }

  /** Saves the whole draft as one request — for an edit, a PUT with the
   *  full data (the backend replaces a record's data wholesale, not a
   *  partial patch); for a new row, a POST creating it for the first
   *  time. */
  async function handleSaveEdit() {
    if (editModalMode === "edit" && editingRecordId != null) {
      setSavingEdit(true);
      setEditSaveError(null);
      try {
        const updated = await updateRecord(editingRecordId, editDraft);
        setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        setEditModalMode(null);
      } catch (error) {
        setEditSaveError(
          error instanceof ApiError
            ? describeApiError(error)
            : "Couldn't save your change. Check your connection and try again."
        );
      } finally {
        setSavingEdit(false);
      }
      return;
    }
    if (editModalMode === "create" && selectedId != null) {
      setSavingEdit(true);
      setEditSaveError(null);
      try {
        const created = await createRecord(selectedId, editDraft);
        setRecords((prev) => [...prev, created]);
        setEditModalMode(null);
      } catch (error) {
        setEditSaveError(
          error instanceof ApiError
            ? describeApiError(error)
            : "Couldn't add this row. Check your connection and try again."
        );
      } finally {
        setSavingEdit(false);
      }
    }
  }

  function handleEditDialogKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      handleCloseEdit();
    }
  }

  function handleDeleteRow(recordId: number) {
    setGridError(null);
    deleteRecord(recordId)
      .then(() => setRecords((prev) => prev.filter((r) => r.id !== recordId)))
      .catch(() => setGridError("Couldn't delete this row. Check your connection and try again."));
  }

  async function handleExport() {
    if (selectedId == null || !template) {
      return;
    }
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
      setExportError(
        error instanceof ApiError ? describeApiError(error) : "Couldn't export this template. Check your connection and try again."
      );
    } finally {
      setExporting(false);
    }
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || selectedId == null) {
      return;
    }
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const result = await importTemplate(selectedId, file);
      setImportResult(result);
    } catch (error) {
      setImportError(
        error instanceof ApiError ? describeApiError(error) : "Couldn't import this file. Check your connection and try again."
      );
      setImporting(false);
      setImportInputKey((k) => k + 1);
      return;
    }
    // A separate try/catch: the import itself already succeeded above, so
    // a failure here (refreshing the grid) must not be reported as an
    // import failure — the file's rows are saved either way.
    try {
      const refreshed = await listRecords(selectedId, search || undefined);
      setRecords(Array.isArray(refreshed) ? refreshed : []);
    } catch {
      setGridError("Imported, but couldn't refresh the grid. Reload to see the new rows.");
    } finally {
      setImporting(false);
      // Remount the file input so selecting the same filename again still
      // fires onChange.
      setImportInputKey((k) => k + 1);
    }
  }

  /** Infers a new template's columns from an uploaded .xlsx file and
   *  imports that same file's rows in one action, then switches straight
   *  to viewing the new template's records — no separate "review the
   *  inferred schema" step; columns can be edited afterward like any
   *  other template, same as a hand-built one. */
  async function handleCreateFromExcel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const name = newTemplateName.trim();
    if (!file) {
      return;
    }
    if (!name) {
      // Was a silent disabled input before this point until a name was
      // typed — picking a file did nothing, with no explanation. Now the
      // file picker is always enabled, and a missing name says so clearly.
      setCreateFromExcelError("Enter a template name first.");
      setCreateFromExcelInputKey((k) => k + 1);
      return;
    }
    setCreatingFromExcel(true);
    setCreateFromExcelError(null);
    try {
      const { template: created, import_result } = await createTemplateFromExcel(name, file);
      setTemplates((prev) => [...prev, created]);
      setNewTemplateName("");
      handleSelect(created.id);
      setImportResult(import_result);
    } catch (error) {
      setCreateFromExcelError(
        error instanceof ApiError
          ? describeApiError(error)
          : "Couldn't create a template from this file. Check your connection and try again."
      );
    } finally {
      setCreatingFromExcel(false);
      setCreateFromExcelInputKey((k) => k + 1);
    }
  }

  return (
    <div className="dv-page">
      <h1 className="dv-header">Handy Recorder</h1>
      <div className="dv-layout">
        <aside className="dv-sidebar">
          <h2>View records for</h2>
          {templatesError ? <p className="dv-sidebar-error">{templatesError}</p> : null}
          <ul className="dv-sidebar-list">
            {templates.map((t) => (
              <li key={t.id} className="dv-sidebar-item">
                <button
                  type="button"
                  className="dv-sidebar-button"
                  aria-current={selectedId === t.id ? "true" : undefined}
                  onClick={() => handleSelect(t.id)}
                >
                  {t.name}
                </button>
              </li>
            ))}
          </ul>

          <div className="dv-create-from-excel">
            <h2>Or create one from Excel</h2>
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
            {createFromExcelError ? <p className="dv-sidebar-error">{createFromExcelError}</p> : null}
            <label className="dv-toolbar-button dv-import-label dv-create-from-excel-button">
              {creatingFromExcel ? "Creating…" : "Choose file…"}
              <input
                key={createFromExcelInputKey}
                type="file"
                accept=".xlsx"
                className="dv-import-input"
                onChange={handleCreateFromExcel}
                disabled={creatingFromExcel}
              />
            </label>
            <p className="dv-hint">Columns and their types are guessed from the file; edit them anytime in Templates.</p>
          </div>
        </aside>

        <main className="dv-main">
          <div className="dv-toolbar">
            <h2>{template ? template.name : "Records"}</h2>
            <label className="dv-search">
              <span className="dv-search-label">Search</span>
              <input
                type="search"
                placeholder="Search records…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </label>
          </div>

          <div className="dv-actions">
            <button type="button" className="dv-add-row" onClick={handleOpenAddRow} disabled={selectedId == null}>
              + Add row
            </button>
            {template && template.columns.length > 0 ? (
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
                    {template.columns.map((col) => (
                      <label key={col.name} className="dv-columns-panel-item">
                        <input
                          type="checkbox"
                          checked={!hiddenColumns.has(col.name)}
                          onChange={() => toggleColumnVisibility(col.name)}
                        />
                        {col.name}
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              className="dv-toolbar-button"
              onClick={handleExport}
              disabled={selectedId == null || exporting}
            >
              {exporting ? "Exporting…" : "Export"}
            </button>
            <label className="dv-toolbar-button dv-import-label">
              {importing ? "Importing…" : "Import"}
              <input
                key={importInputKey}
                type="file"
                accept=".xlsx"
                className="dv-import-input"
                onChange={handleImportFile}
                disabled={selectedId == null || importing}
              />
            </label>
          </div>

          {recordsError ? <p className="dv-error">{recordsError}</p> : null}
          {gridError ? <p className="dv-error">{gridError}</p> : null}
          {exportError ? <p className="dv-error">{exportError}</p> : null}
          {importError ? <p className="dv-error">{importError}</p> : null}

          {importResult ? (
            importResult.errors.some((error) => error.row_number === 0) ? (
              // Row 0 means the file as a whole couldn't be read (e.g. a
              // required column is missing from its header) — nothing was
              // imported, so this isn't a row count, it's the one reason.
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

          {selectedId == null ? (
            <p className="dv-empty">Select a template to view its records.</p>
          ) : showFullLoading ? (
            <p className="dv-loading" role="status">
              Loading records…
            </p>
          ) : (
            <>
              {searching ? (
                <p className="dv-searching" role="status">
                  Searching…
                </p>
              ) : null}
              <p className="dv-hint">
                Use the Edit button at the end of a row to change its values in a form. The grid itself is
                view-only, so nothing changes from a stray click.
              </p>
              <div className="dv-grid">
                <AgGridReact
                  theme={gridTheme}
                  rowData={rowData}
                  columnDefs={columnDefs}
                  defaultColDef={defaultColDef}
                  getRowId={(params) => String(params.data.id)}
                  overlayNoRowsTemplate="No records yet."
                  pagination
                  paginationPageSize={25}
                  paginationPageSizeSelector={[25, 50, 100]}
                  onFirstDataRendered={(event) => event.api.autoSizeColumns(["__actions"])}
                  onGridReady={(event) => event.api.autoSizeColumns(["__actions"])}
                />
              </div>
            </>
          )}
        </main>
      </div>

      {editModalMode && template ? (
        <div className="dv-overlay" onKeyDown={handleEditDialogKeyDown}>
          <div
            className="dv-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dv-edit-title"
          >
            <h2 id="dv-edit-title">{editModalMode === "create" ? "Add row" : "Edit row"}</h2>
            <div className="dv-edit-fields">
              {template.columns
                .filter((col) => col.formula == null)
                .map((col) => (
                  <label key={col.name} className="dv-field">
                    <span className="dv-search-label">{col.name}</span>
                    {col.type === "boolean" ? (
                      <input
                        type="checkbox"
                        checked={Boolean(editDraft[col.name])}
                        onChange={(e) => handleEditFieldChange(col.name, e.target.checked)}
                      />
                    ) : col.type === "number" ? (
                      <input
                        type="number"
                        value={editDraft[col.name] == null ? "" : String(editDraft[col.name])}
                        onChange={(e) =>
                          handleEditFieldChange(col.name, e.target.value === "" ? null : Number(e.target.value))
                        }
                      />
                    ) : col.type === "date" ? (
                      <input
                        type="date"
                        value={editDraft[col.name] == null ? "" : String(editDraft[col.name])}
                        onChange={(e) => handleEditFieldChange(col.name, e.target.value || null)}
                      />
                    ) : (
                      <input
                        type="text"
                        value={editDraft[col.name] == null ? "" : String(editDraft[col.name])}
                        onChange={(e) => handleEditFieldChange(col.name, e.target.value)}
                      />
                    )}
                  </label>
                ))}
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
    </div>
  );
}
