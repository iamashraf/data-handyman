import { useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { ModuleRegistry, AllCommunityModule, themeQuartz } from "ag-grid-community";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { getTemplate, listRecords, listTemplates } from "../api/client";
import type { RecordRead, TemplateColumn, TemplateRead } from "../api/types";
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

  const latestRequest = useRef(0);
  const loadedTemplateId = useRef<number | undefined>(undefined);

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
    return template.columns.map((col) => ({
      field: col.name,
      headerName: col.name,
      flex: 1,
      minWidth: 120,
      // Disable AG-Grid's automatic value-based cell data typing (which
      // otherwise swaps in its own built-in checkbox renderer for boolean
      // values), so every column uniformly goes through ValueCell below.
      cellDataType: false,
      cellClass: col.type === "number" ? "dv-numeric" : undefined,
      cellRendererParams: { columnType: col.type },
    }));
  }, [template]);

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
  }

  return (
    <div className="dv-page">
      <h1 className="dv-header">Handy Recorder</h1>
      <div className="dv-layout">
        <aside className="dv-sidebar">
          <h2>Templates</h2>
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

          {recordsError ? <p className="dv-error">{recordsError}</p> : null}

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
              <div className="dv-grid">
                <AgGridReact
                  theme={gridTheme}
                  rowData={rowData}
                  columnDefs={columnDefs}
                  defaultColDef={defaultColDef}
                  getRowId={(params) => String(params.data.id)}
                  overlayNoRowsTemplate="No records yet."
                />
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
