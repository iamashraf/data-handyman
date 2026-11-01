import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  exportTemplate,
  getSummary,
  getTemplate,
  listTemplates,
} from "../api/client";
import type { SummaryRow, TemplateColumn, TemplateRead } from "../api/types";
import "./SummaryViewPage.css";

/*
 * Design direction (frontend-design skill, invoked for this page): this is
 * the third page in the greenbar-ledger system established by
 * TemplateBuilderPage and reused by DataViewPage, so no new color or type
 * decision is made here — every value below is a token from
 * src/styles/tokens.css. The sidebar/main-panel structure mirrors
 * DataViewPage.tsx exactly (same template index, same panel chrome) so
 * picking a template to summarize feels like the same product, not a
 * fourth navigation pattern.
 *
 * The one genuinely new surface is the chart. See BarChart below for the
 * dataviz-skill reasoning; the short version is: this is a magnitude
 * comparison across a template's own column values (nominal categories,
 * not a tracked identity), so it gets the sequential/single-hue treatment
 * — every bar in --accent, no legend — rather than a rainbow of
 * per-category colors, which would just re-encode what the bar's length
 * already shows.
 */

interface SummaryViewPageProps {
  templateId?: number;
  /** When given, the group-by/metric pickers render from this column list
   *  immediately instead of waiting on a `getTemplate` fetch — lets a
   *  caller (or a test) supply a template's columns directly without a
   *  network round trip. Production usage (App.tsx) omits it and relies
   *  on the normal fetch-by-id path below. */
  columns?: TemplateColumn[];
}

const BAR_ROW_HEIGHT = 32;
const BAR_THICKNESS = 18;
const CHART_WIDTH = 560;
const LABEL_WIDTH = 140;
const PLOT_RIGHT_MARGIN = 56; // room for the value label past the bar tip
const PLOT_LEFT = LABEL_WIDTH;
const PLOT_WIDTH = CHART_WIDTH - PLOT_LEFT - PLOT_RIGHT_MARGIN;
const AXIS_HEIGHT = 28;
const MAX_LABEL_CHARS = 16;

/** Plain-language display text for a group-by value. Mirrors
 *  DataViewPage's formatValue boolean rule (kept local, same reasoning as
 *  that file's own comment: the only other call site, not worth sharing). */
function formatGroupLabel(value: unknown): string {
  if (value == null) {
    return "(blank)";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return String(value);
}

function truncateLabel(label: string): string {
  return label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS - 1)}…` : label;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
}

/** Compact axis-tick text: 0 / 1K / 2.5K — at most one decimal, never the
 *  two-decimal precision a direct bar-value label gets (formatNumber). */
function formatTick(value: number): string {
  if (Math.abs(value) >= 1000) {
    const k = value / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);
}

/** The next round value at or above `value`, for the chart's top gridline —
 *  e.g. 47 -> 50, 340 -> 500, 3 -> 5. */
function niceMax(value: number): number {
  if (value <= 0) {
    return 1;
  }
  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** exponent;
  const residual = value / magnitude;
  const step = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  return step * magnitude;
}

interface ChartDatum {
  key: string;
  label: string;
  value: number;
}

/**
 * Horizontal bar chart for one measure (count, or a summed metric) across
 * a template's group-by values.
 *
 * dataviz-skill reasoning applied here:
 * - Form: the reader's job is "compare magnitude across categories" ->
 *   bar chart (choosing-a-form.md's magnitude row), not a pie/donut.
 * - Color: these bars are one series (the group-by values are nominal
 *   categories of the *same* measure, not tracked identities), so every
 *   bar takes the same slot-1 hue (--accent) per color-formula.md's
 *   nominal-categorical rule, and there is no legend box — the <h3>
 *   title above the chart already names what's plotted.
 * - Two measures (count vs. a summed metric) never share one chart or a
 *   dual y-axis (the #1 anti-pattern in the skill) — the caller renders
 *   a second, separate <BarChart> for the metric instead.
 * - Marks: bars are capped at 18px thick inside a 32px row band (never
 *   fill the slot), 4px rounded at the data end, square at the baseline.
 *   Gridlines are hairline, --rule-colored, behind the bars.
 * - Labels: the value sits directly at the bar's tip (always fits — it's
 *   outside the bar, not clipped by it) so every value is readable
 *   without hovering; the table below the chart is the full data view
 *   the skill asks every chart to have. Per interaction.md, a tooltip may
 *   only *enhance* — never gate — a value, and every value here is
 *   already a direct label plus a table row, so hover is a bonus, not a
 *   second way to reach data a keyboard user couldn't otherwise get.
 * - Interaction: each bar carries a native <title> tooltip (category +
 *   value) and lifts slightly on hover (brightness, not a new color).
 *   The bars are not separately focusable — a native <title> never
 *   appears on keyboard focus in any browser, so a tab stop there would
 *   cost a keyboard user a stop and give them nothing; the same values
 *   are already reachable via the direct labels and the table below.
 */
function BarChart({ title, data }: { title: string; data: ChartDatum[] }) {
  const max = niceMax(Math.max(1, ...data.map((d) => d.value)));
  const mid = max / 2;
  // "Round to clean numbers" (marks-and-anatomy.md) means a count axis
  // (always whole numbers) never gets a half-integer gridline like
  // "0.50" — when every value plotted is a whole number and the midpoint
  // isn't one too, drop it and keep just the two clean ends.
  const allIntegers = data.every((d) => Number.isInteger(d.value));
  const ticks = allIntegers && !Number.isInteger(mid) ? [0, max] : [0, mid, max];
  const plotHeight = data.length * BAR_ROW_HEIGHT;
  const height = plotHeight + AXIS_HEIGHT;

  return (
    <div className="sv-chart">
      <h3 className="sv-chart-title">{title}</h3>
      <svg className="sv-chart-svg" width={CHART_WIDTH} height={height}>
        {ticks.map((t) => {
          const x = PLOT_LEFT + (t / max) * PLOT_WIDTH;
          return (
            <line
              key={`grid-${t}`}
              className="sv-gridline"
              x1={x}
              x2={x}
              y1={0}
              y2={plotHeight}
            />
          );
        })}
        {data.map((d, i) => {
          const y = i * BAR_ROW_HEIGHT + (BAR_ROW_HEIGHT - BAR_THICKNESS) / 2;
          const barWidth = Math.max(1, (d.value / max) * PLOT_WIDTH);
          const radius = Math.min(4, barWidth);
          return (
            <g key={d.key} className="sv-bar-row">
              <title>{`${d.label}: ${formatNumber(d.value)}`}</title>
              <text
                x={PLOT_LEFT - 10}
                y={y + BAR_THICKNESS / 2}
                textAnchor="end"
                dominantBaseline="middle"
                className="sv-bar-label"
              >
                {truncateLabel(d.label)}
              </text>
              {/* Full bar, rounded on every corner. */}
              <rect
                className="sv-bar"
                x={PLOT_LEFT}
                y={y}
                width={barWidth}
                height={BAR_THICKNESS}
                rx={radius}
                ry={radius}
              />
              {/* Squares off the baseline (left) end by covering its
                  rounded corners — only the data end (the tip) stays
                  rounded, per the mark spec. */}
              {radius > 0 && barWidth > radius ? (
                <rect
                  className="sv-bar"
                  x={PLOT_LEFT}
                  y={y}
                  width={radius}
                  height={BAR_THICKNESS}
                />
              ) : null}
              <text
                x={PLOT_LEFT + barWidth + 8}
                y={y + BAR_THICKNESS / 2}
                dominantBaseline="middle"
                className="sv-bar-value"
              >
                {formatNumber(d.value)}
              </text>
            </g>
          );
        })}
        <line className="sv-baseline" x1={PLOT_LEFT} x2={PLOT_LEFT} y1={0} y2={plotHeight} />
        {ticks.map((t) => {
          const x = PLOT_LEFT + (t / max) * PLOT_WIDTH;
          return (
            <text key={`tick-${t}`} className="sv-axis-tick" x={x} y={plotHeight + 18} textAnchor="middle">
              {formatTick(t)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

/** Turns an ApiError's body into a message a non-technical user can read.
 *  Mirrors DataViewPage's describeApiError (kept local — same file-local
 *  convention used there). */
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
  groupBy: string;
  metric: string;
}

export function SummaryViewPage({ templateId, columns }: SummaryViewPageProps) {
  const [templates, setTemplates] = useState<TemplateRead[]>([]);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | undefined>(templateId);
  const [template, setTemplate] = useState<TemplateRead | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState("");
  const [metric, setMetric] = useState("");
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [summaryParams, setSummaryParams] = useState<SummaryParams | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const latestSummaryRequest = useRef(0);

  // The template on hand must match the currently selected template before
  // its columns are safe to show — otherwise, for a moment while a new
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
    // Bump this on every run of the effect, even the early-return below —
    // otherwise a still-in-flight request from a template/column that was
    // just switched away from stays "latest" and gets stored once it
    // resolves, surfacing stale data under the new selection's heading.
    const requestId = ++latestSummaryRequest.current;
    if (selectedId == null || !groupBy) {
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
        // in place — a failed refetch shouldn't blank out a result that was
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
    setGroupBy("");
    setMetric("");
    setSummary([]);
    setSummaryParams(null);
    setSummaryError(null);
    setExportError(null);
  }

  async function handleExport() {
    if (selectedId == null || !columnsReady || !groupBy) {
      return;
    }
    setExporting(true);
    setExportError(null);
    try {
      const blob = await exportTemplate(selectedId, {
        includeSummary: true,
        groupBy,
        metric: metric || undefined,
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
  const countChartData: ChartDatum[] = summary.map((row, i) => ({
    key: `count-${i}`,
    label: formatGroupLabel(row.group_value),
    value: row.count,
  }));
  const sumChartData: ChartDatum[] = summary.map((row, i) => ({
    key: `sum-${i}`,
    label: formatGroupLabel(row.group_value),
    value: row.sum ?? 0,
  }));

  return (
    <div className="sv-page">
      <h1 className="sv-header">Data Handyman</h1>
      <div className="sv-layout">
        <aside className="sv-sidebar">
          <h2>Templates</h2>
          {templatesError ? <p className="sv-sidebar-error">{templatesError}</p> : null}
          <ul className="sv-sidebar-list">
            {templates.map((t) => (
              <li key={t.id} className="sv-sidebar-item">
                <button
                  type="button"
                  className="sv-sidebar-button"
                  aria-current={selectedId === t.id ? "true" : undefined}
                  onClick={() => handleSelect(t.id)}
                >
                  {t.name}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="sv-main">
          <div className="sv-toolbar">
            <h2>{template ? template.name : "Summary"}</h2>
          </div>

          {templateError ? <p className="sv-error">{templateError}</p> : null}

          {selectedId == null ? (
            <p className="sv-empty">Select a template to summarize its records.</p>
          ) : !columnsReady ? (
            <p className="sv-loading" role="status">
              Loading…
            </p>
          ) : (
            <>
              <div className="sv-controls">
                <label className="sv-field">
                  <span>Group by</span>
                  <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                    <option value="">Choose a column…</option>
                    {effectiveColumns.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
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
                <button
                  type="button"
                  className="sv-toolbar-button"
                  onClick={handleExport}
                  disabled={!groupBy || exporting}
                >
                  {exporting ? "Exporting…" : "Export with summary"}
                </button>
              </div>

              {exportError ? <p className="sv-error">{exportError}</p> : null}
              {summaryError ? <p className="sv-error">{summaryError}</p> : null}

              {!groupBy ? (
                <p className="sv-empty">Pick a column to group by to see the summary.</p>
              ) : !activeParams && summaryLoading ? (
                <p className="sv-loading" role="status">
                  Loading summary…
                </p>
              ) : !activeParams ? (
                <p className="sv-empty">No records to summarize yet.</p>
              ) : (
                // A refetch (metric/group-by change) keeps this previous,
                // correctly-labeled result on screen — dimmed, not blanked
                // — instead of flashing to a loading state. activeParams
                // (not the live groupBy/metric) names what's actually
                // plotted below, so the title never gets ahead of the data.
                <div className={summaryLoading ? "sv-results sv-stale" : "sv-results"} aria-busy={summaryLoading}>
                  <div className="sv-charts">
                    <BarChart title={`Count by ${activeParams.groupBy}`} data={countChartData} />
                    {activeParams.metric ? (
                      <BarChart title={`Total ${activeParams.metric} by ${activeParams.groupBy}`} data={sumChartData} />
                    ) : null}
                  </div>

                  <div className="sv-table-wrap">
                    <table className="sv-table">
                      <thead>
                        <tr>
                          <th>{activeParams.groupBy}</th>
                          <th>Count</th>
                          {activeParams.metric ? <th>Total {activeParams.metric}</th> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {summary.map((row, i) => (
                          <tr key={i}>
                            <td>{formatGroupLabel(row.group_value)}</td>
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
            </>
          )}
        </main>
      </div>
    </div>
  );
}
