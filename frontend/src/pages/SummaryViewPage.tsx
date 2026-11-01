import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ApiError,
  createSummaryView,
  deleteSummaryView,
  exportTemplate,
  getSummary,
  getTemplate,
  listSummaryViews,
  listTemplates,
} from "../api/client";
import type { ChartType, SummaryRow, SummaryViewRead, TemplateColumn, TemplateRead } from "../api/types";
import "./SummaryViewPage.css";

/*
 * Design direction (frontend-design + dataviz skills, invoked for this
 * page): charts are rendered with Recharts rather than hand-rolled SVG, so
 * this page can offer more than one chart type (bar/line/area/pie) without
 * a bespoke renderer per type. Every chart still reads its colors from this
 * app's own CSS tokens (tokens.css) instead of a library default palette:
 * a single measure (count, or a summed metric) across a template's own
 * category values is magnitude, not identity, so bar/line/area stay in the
 * one --accent hue with no legend (the chart title already names what's
 * plotted) -- only the pie chart's slices are genuinely categorical
 * (part-to-whole across distinct group values) and take the validated
 * --viz-series-1..8 categorical palette defined in tokens.css, folding
 * anything past 8 slices into a neutral "Other" bucket rather than
 * generating a 9th hue. The data table below every chart is the full-detail
 * view the skill asks every chart to have, so nothing is gated behind a
 * hover tooltip.
 */

interface SummaryViewPageProps {
  templateId?: number;
  /** When given, the group-by/metric pickers render from this column list
   *  immediately instead of waiting on a `getTemplate` fetch -- lets a
   *  caller (or a test) supply a template's columns directly without a
   *  network round trip. Production usage (App.tsx) omits it and relies
   *  on the normal fetch-by-id path below. */
  columns?: TemplateColumn[];
}

const CHART_HEIGHT = 240;
const CARD_CHART_HEIGHT = 160;
const PIE_SLICE_CAP = 8;

interface ChartDatum {
  key: string;
  label: string;
  value: number;
}

/** Plain-language display text for a group-by value. */
function formatGroupLabel(value: unknown): string {
  if (value == null) {
    return "(blank)";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return String(value);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
}

const MAX_LABEL_CHARS = 18;

/** Chart axis space is finite -- a label past this length is truncated
 *  with an ellipsis rather than left to overlap its neighbors. The full
 *  value is never actually gated: it's still in the table below every
 *  chart (and, for a single group-by column, in the tooltip too, since
 *  recharts' default tooltip label is this same string). */
function truncateLabel(label: string): string {
  return label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS - 1)}…` : label;
}

/** Joins a row's values for every group-by dimension into one display
 *  label, e.g. ["region", "status"] -> "West / Open". */
function compositeLabel(row: SummaryRow, groupBy: string[]): string {
  return truncateLabel(groupBy.map((column) => formatGroupLabel(row.group_values[column])).join(" / "));
}

function toChartData(rows: SummaryRow[], groupBy: string[], valueKey: "count" | "sum"): ChartDatum[] {
  return rows.map((row, i) => ({
    key: `${valueKey}-${i}`,
    label: compositeLabel(row, groupBy),
    value: valueKey === "count" ? row.count : row.sum ?? 0,
  }));
}

/** Pie slices only -- folds anything past the categorical palette's 8
 *  slots into a single neutral "Other" slice instead of generating a 9th
 *  hue (dataviz skill's series-count ceiling). */
function toPieSlices(data: ChartDatum[]): (ChartDatum & { isOther: boolean })[] {
  const sorted = [...data].sort((a, b) => b.value - a.value);
  if (sorted.length <= PIE_SLICE_CAP) {
    return sorted.map((d) => ({ ...d, isOther: false }));
  }
  const head = sorted.slice(0, PIE_SLICE_CAP - 1);
  const tail = sorted.slice(PIE_SLICE_CAP - 1);
  const otherValue = tail.reduce((sum, d) => sum + d.value, 0);
  return [
    ...head.map((d) => ({ ...d, isOther: false })),
    { key: "other", label: "Other", value: otherValue, isOther: true },
  ];
}

const TOOLTIP_STYLE: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--rule)",
  borderRadius: 6,
  color: "var(--ink)",
  fontSize: 12,
};

const AXIS_TICK = { fill: "var(--ink-muted)", fontSize: 11 };

/** Renders one of bar/line/area/pie for a single-measure dataset, themed
 *  from this app's own CSS tokens. See the file-top comment for the
 *  dataviz-skill reasoning behind the color choices. */
function RenderedChart({
  type,
  data,
  seriesName,
  height = CHART_HEIGHT,
}: {
  type: ChartType;
  data: ChartDatum[];
  seriesName: string;
  height?: number;
}) {
  if (data.length === 0) return null;

  if (type === "pie") {
    const slices = toPieSlices(data);
    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie data={slices} dataKey="value" nameKey="label" innerRadius="45%" outerRadius="80%" paddingAngle={1}>
            {slices.map((slice, i) => (
              <Cell key={slice.key} fill={slice.isOther ? "var(--ink-muted)" : `var(--viz-series-${i + 1})`} />
            ))}
          </Pie>
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => formatNumber(Number(value))} />
          <Legend wrapperStyle={{ fontSize: 12, color: "var(--ink)" }} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  // Angle (and give the axis more height) past 4 bars -- even a truncated
  // label doesn't reliably fit flat once there's no room to space them out.
  const angled = data.length > 4;
  const sharedAxes = (
    <>
      <CartesianGrid stroke="var(--rule)" strokeOpacity={0.6} vertical={false} />
      <XAxis
        dataKey="label"
        tick={AXIS_TICK}
        tickLine={false}
        axisLine={{ stroke: "var(--rule)" }}
        interval={0}
        angle={angled ? -35 : 0}
        textAnchor={angled ? "end" : "middle"}
        height={angled ? 70 : 30}
      />
      <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => [formatNumber(Number(value)), seriesName]} />
    </>
  );

  if (type === "line") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data}>
          {sharedAxes}
          <Line
            type="monotone"
            dataKey="value"
            name={seriesName}
            stroke="var(--accent)"
            strokeWidth={2}
            dot={{ r: 4, fill: "var(--accent)", strokeWidth: 2, stroke: "var(--surface)" }}
          />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (type === "area") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data}>
          {sharedAxes}
          <Area type="monotone" dataKey="value" name={seriesName} stroke="var(--accent)" strokeWidth={2} fill="var(--accent)" fillOpacity={0.1} />
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data}>
        {sharedAxes}
        <Bar dataKey="value" name={seriesName} fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Turns an ApiError's body into a message a non-technical user can read. */
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

/** The group-by/metric values that produced a rendered `SummaryRow[]`,
 *  captured alongside the rows themselves. Chart titles and table headers
 *  are built from this, not from the live picker state, so a result stays
 *  correctly labeled while a newer request for a different column is
 *  still in flight (see the "no flash" handling below). */
interface SummaryParams {
  groupBy: string[];
  metric: string;
}

/** One card in the saved-views dashboard grid: fetches and renders its own
 *  summary independent of the page's active picker state, so each widget
 *  is a self-contained unit (its own data, its own loading/error state). */
function SavedViewCard({
  templateId,
  view,
  onLoad,
  onDelete,
}: {
  templateId: number;
  view: SummaryViewRead;
  onLoad: (view: SummaryViewRead) => void;
  onDelete: (view: SummaryViewRead) => void;
}) {
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getSummary(templateId, view.group_by, view.metric ?? undefined)
      .then((result) => {
        if (!active) return;
        setRows(Array.isArray(result) ? result : []);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof ApiError ? describeApiError(err) : "Couldn't load this view.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [templateId, view.id, view.group_by, view.metric]);

  const chartData = toChartData(rows, view.group_by, view.metric ? "sum" : "count");

  return (
    <div className="sv-card">
      <div className="sv-card-header">
        <button type="button" className="sv-card-title" onClick={() => onLoad(view)}>
          {view.name}
        </button>
        <button type="button" className="sv-card-delete" aria-label={`Delete view ${view.name}`} onClick={() => onDelete(view)}>
          ×
        </button>
      </div>
      <p className="sv-card-subtitle">
        {view.group_by.join(", ")}
        {view.metric ? ` · total ${view.metric}` : " · count"}
      </p>
      {loading ? (
        <p className="sv-loading" role="status">
          Loading…
        </p>
      ) : error ? (
        <p className="dv-error">{error}</p>
      ) : (
        <RenderedChart
          type={view.chart_type}
          data={chartData}
          seriesName={view.metric ? `Total ${view.metric}` : "Count"}
          height={CARD_CHART_HEIGHT}
        />
      )}
    </div>
  );
}

export function SummaryViewPage({ templateId, columns }: SummaryViewPageProps) {
  const [templates, setTemplates] = useState<TemplateRead[]>([]);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | undefined>(templateId);
  const [template, setTemplate] = useState<TemplateRead | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [metric, setMetric] = useState("");
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [summaryParams, setSummaryParams] = useState<SummaryParams | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [groupByMenuOpen, setGroupByMenuOpen] = useState(false);
  const [savedViews, setSavedViews] = useState<SummaryViewRead[]>([]);
  const [savedViewsError, setSavedViewsError] = useState<string | null>(null);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const [savingView, setSavingView] = useState(false);
  const [saveViewError, setSaveViewError] = useState<string | null>(null);

  const latestSummaryRequest = useRef(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const groupByMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen && !groupByMenuOpen) return;
    function handleOutsideClick(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
      if (groupByMenuRef.current && !groupByMenuRef.current.contains(event.target as Node)) {
        setGroupByMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [dropdownOpen, groupByMenuOpen]);

  function toggleGroupByColumn(name: string) {
    setGroupBy((prev) => (prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name]));
  }

  // The template on hand must match the currently selected template before
  // its columns are safe to show -- otherwise, for a moment while a new
  // template's fetch is in flight, the pickers (and an in-flight
  // getSummary call) could still be using the *previous* template's
  // columns. Mirrors DataViewPage's columnsReady guard. An explicitly
  // supplied `columns` prop sidesteps the fetch entirely, so it's always
  // ready.
  const columnsReady = columns != null || (template != null && template.id === selectedId);
  const effectiveColumns = columns ?? (columnsReady && template ? template.columns : []);

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
    setTemplateError(null);
    getTemplate(selectedId)
      .then(setTemplate)
      .catch(() => setTemplateError("Couldn't load this template. Check your connection and try again."));
  }, [selectedId]);

  useEffect(() => {
    if (selectedId == null) {
      setSavedViews([]);
      return;
    }
    setSavedViewsError(null);
    listSummaryViews(selectedId)
      .then((result) => setSavedViews(Array.isArray(result) ? result : []))
      .catch(() => setSavedViewsError("Couldn't load saved views. Check your connection and try again."));
  }, [selectedId]);

  useEffect(() => {
    // Bump this on every run of the effect, even the early-return below --
    // otherwise a still-in-flight request from a template/column that was
    // just switched away from stays "latest" and gets stored once it
    // resolves, surfacing stale data under the new selection's heading.
    const requestId = ++latestSummaryRequest.current;
    if (selectedId == null || groupBy.length === 0) {
      setSummary([]);
      setSummaryParams(null);
      setSummaryError(null);
      setSummaryLoading(false);
      return;
    }
    const requestParams: SummaryParams = { groupBy, metric };
    setSummaryLoading(true);
    setSummaryError(null);
    getSummary(selectedId, groupBy, metric || undefined)
      .then((rows) => {
        if (requestId !== latestSummaryRequest.current) {
          return;
        }
        setSummary(Array.isArray(rows) ? rows : []);
        setSummaryParams(requestParams);
      })
      .catch((error) => {
        if (requestId !== latestSummaryRequest.current) {
          return;
        }
        // Deliberately leave any previously loaded `summary`/`summaryParams`
        // in place -- a failed refetch shouldn't blank out a result that was
        // already showing (same "keep the frame" principle as the loading
        // state below).
        setSummaryError(
          error instanceof ApiError
            ? describeApiError(error)
            : "Couldn't load the summary. Check your connection and try again."
        );
      })
      .finally(() => {
        if (requestId === latestSummaryRequest.current) {
          setSummaryLoading(false);
        }
      });
  }, [selectedId, groupBy, metric]);

  function handleSelect(id: number) {
    setSelectedId(id);
    setGroupBy([]);
    setMetric("");
    setChartType("bar");
    setSummary([]);
    setSummaryParams(null);
    setSummaryError(null);
    setExportError(null);
    setDropdownOpen(false);
    setGroupByMenuOpen(false);
    setSaveViewOpen(false);
  }

  function handleLoadView(view: SummaryViewRead) {
    setGroupBy(view.group_by);
    setMetric(view.metric ?? "");
    setChartType(view.chart_type);
  }

  async function handleDeleteView(view: SummaryViewRead) {
    const confirmed = window.confirm(`Delete the saved view "${view.name}"?`);
    if (!confirmed) return;
    try {
      await deleteSummaryView(view.id);
      setSavedViews((prev) => prev.filter((v) => v.id !== view.id));
    } catch {
      setSavedViewsError("Couldn't delete this view. Check your connection and try again.");
    }
  }

  async function handleCreateView() {
    if (selectedId == null || groupBy.length === 0 || !newViewName.trim()) return;
    setSavingView(true);
    setSaveViewError(null);
    try {
      const created = await createSummaryView(selectedId, {
        name: newViewName.trim(),
        groupBy,
        metric: metric || undefined,
        chartType,
      });
      setSavedViews((prev) => [...prev, created]);
      setNewViewName("");
      setSaveViewOpen(false);
    } catch (error) {
      setSaveViewError(
        error instanceof ApiError ? describeApiError(error) : "Couldn't save this view. Check your connection and try again."
      );
    } finally {
      setSavingView(false);
    }
  }

  async function handleExport() {
    if (selectedId == null || !columnsReady || groupBy.length === 0) {
      return;
    }
    setExporting(true);
    setExportError(null);
    try {
      const blob = await exportTemplate(selectedId, {
        includeSummary: true,
        groupBy,
        metric: metric || undefined,
        chartType,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${template?.name ?? "Summary"} summary.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(
        error instanceof ApiError
          ? describeApiError(error)
          : "Couldn't export this summary. Check your connection and try again."
      );
    } finally {
      setExporting(false);
    }
  }

  const numberColumns = effectiveColumns.filter((c) => c.type === "number");
  const activeParams = summaryParams != null && summary.length > 0 ? summaryParams : null;
  const countChartData = activeParams ? toChartData(summary, activeParams.groupBy, "count") : [];
  const sumChartData = activeParams ? toChartData(summary, activeParams.groupBy, "sum") : [];

  return (
    <div className="dv-page">
      <div className="dv-topbar">
        <div className="dv-title-group">
          <h2>{template ? template.name : "Summary"}</h2>
        </div>
        <div className="dv-topbar-right">
          <div className="dv-template-dropdown" ref={dropdownRef}>
            <button
              type="button"
              className="dv-toolbar-button dv-template-dropdown-button"
              onClick={() => setDropdownOpen((o) => !o)}
              aria-expanded={dropdownOpen}
              aria-haspopup="listbox"
            >
              <span className="dv-template-dropdown-button-label">{template ? template.name : "Select a template"}</span>
              <span className="dv-template-dropdown-button-chevron" aria-hidden="true">▾</span>
            </button>
            {dropdownOpen ? (
              <div className="dv-template-dropdown-panel" role="listbox">
                {templates.map((t) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedId === t.id}
                    key={t.id}
                    className="dv-template-dropdown-item"
                    onClick={() => handleSelect(t.id)}
                  >
                    <span>{t.name}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {templatesError ? <p className="dv-error">{templatesError}</p> : null}
      {templateError ? <p className="dv-error">{templateError}</p> : null}

      <div className="sv-body">
        {selectedId == null ? (
          <p className="sv-empty">Select a template to summarize its records.</p>
        ) : !columnsReady ? (
          <p className="sv-loading" role="status">
            Loading…
          </p>
        ) : (
          <>
            <div className="sv-controls">
              <div className="sv-field sv-groupby-menu" ref={groupByMenuRef}>
                <span>Group by</span>
                <button
                  type="button"
                  className="dv-toolbar-button sv-groupby-button"
                  onClick={() => setGroupByMenuOpen((o) => !o)}
                  aria-expanded={groupByMenuOpen}
                  aria-haspopup="menu"
                  aria-label={`Group by${groupBy.length > 0 ? ` (${groupBy.length} selected)` : ""}`}
                >
                  {groupBy.length === 0 ? "Choose columns…" : groupBy.join(", ")}
                  <span aria-hidden="true"> ▾</span>
                </button>
                {groupByMenuOpen ? (
                  <div className="menu-panel menu-panel-scroll" role="menu">
                    {effectiveColumns.map((c) => (
                      <label key={c.name} className="menu-item sv-groupby-item">
                        <input type="checkbox" checked={groupBy.includes(c.name)} onChange={() => toggleGroupByColumn(c.name)} />
                        {c.name}
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
              <label className="sv-field">
                <span>Metric (optional)</span>
                <select value={metric} onChange={(e) => setMetric(e.target.value)}>
                  <option value="">None</option>
                  {numberColumns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sv-field">
                <span>Chart type</span>
                <select value={chartType} onChange={(e) => setChartType(e.target.value as ChartType)}>
                  <option value="bar">Bar</option>
                  <option value="line">Line</option>
                  <option value="area">Area</option>
                  <option value="pie">Pie</option>
                </select>
              </label>
              <button type="button" className="dv-toolbar-button" onClick={handleExport} disabled={groupBy.length === 0 || exporting}>
                {exporting ? "Exporting…" : "Export with summary"}
              </button>
              <button
                type="button"
                className="dv-toolbar-button"
                onClick={() => setSaveViewOpen((o) => !o)}
                disabled={groupBy.length === 0}
              >
                Save as view
              </button>
            </div>

            {saveViewOpen ? (
              <div className="sv-save-view-row">
                <input
                  type="text"
                  placeholder="View name…"
                  value={newViewName}
                  onChange={(e) => setNewViewName(e.target.value)}
                  autoFocus
                />
                <button type="button" className="dv-toolbar-button" onClick={handleCreateView} disabled={savingView || !newViewName.trim()}>
                  {savingView ? "Saving…" : "Save"}
                </button>
                <button type="button" className="dv-toolbar-button" onClick={() => setSaveViewOpen(false)} disabled={savingView}>
                  Cancel
                </button>
                {saveViewError ? <p className="dv-error">{saveViewError}</p> : null}
              </div>
            ) : null}

            {exportError ? <p className="dv-error">{exportError}</p> : null}
            {summaryError ? <p className="dv-error">{summaryError}</p> : null}

            {groupBy.length === 0 ? (
              <div className="empty-state">
                <p>Pick one or more columns to group by to see the summary.</p>
              </div>
            ) : !activeParams && summaryLoading ? (
              <p className="sv-loading" role="status">
                Loading summary…
              </p>
            ) : !activeParams ? (
              <div className="empty-state">
                <p>No records to summarize yet.</p>
              </div>
            ) : (
              // A refetch (metric/group-by change) keeps this previous,
              // correctly-labeled result on screen -- dimmed, not blanked
              // -- instead of flashing to a loading state. activeParams
              // (not the live groupBy/metric) names what's actually
              // plotted below, so the title never gets ahead of the data.
              <div className={summaryLoading ? "sv-results sv-stale" : "sv-results"} aria-busy={summaryLoading}>
                <div className="sv-charts">
                  <div className="sv-chart sv-chart-single">
                    <h3 className="sv-chart-title">
                      {activeParams.metric
                        ? `Total ${activeParams.metric} by ${activeParams.groupBy.join(", ")}`
                        : `Count by ${activeParams.groupBy.join(", ")}`}
                    </h3>
                    <RenderedChart
                      type={chartType}
                      data={activeParams.metric ? sumChartData : countChartData}
                      seriesName={activeParams.metric ? `Total ${activeParams.metric}` : "Count"}
                    />
                  </div>
                </div>

                <div className="sv-table-wrap">
                  <table className="sv-table">
                    <thead>
                      <tr>
                        {activeParams.groupBy.map((column) => (
                          <th key={column}>{column}</th>
                        ))}
                        <th>Count</th>
                        {activeParams.metric ? <th>Total {activeParams.metric}</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {summary.map((row, i) => (
                        <tr key={i}>
                          {activeParams.groupBy.map((column) => (
                            <td key={column}>{formatGroupLabel(row.group_values[column])}</td>
                          ))}
                          <td className="sv-numeric">{row.count}</td>
                          {activeParams.metric ? (
                            <td className="sv-numeric">{row.sum != null ? formatNumber(row.sum) : "—"}</td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {savedViewsError ? <p className="dv-error">{savedViewsError}</p> : null}
            {savedViews.length > 0 && selectedId != null ? (
              <div className="sv-dashboard">
                <h3 className="sv-dashboard-title">Saved views</h3>
                <div className="sv-dashboard-grid">
                  {savedViews.map((view) => (
                    <SavedViewCard key={view.id} templateId={selectedId} view={view} onLoad={handleLoadView} onDelete={handleDeleteView} />
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
