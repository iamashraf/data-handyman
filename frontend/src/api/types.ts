export interface TemplateColumn {
  name: string;
  type: "text" | "number" | "date" | "boolean";
  formula: string | null;
  /** Display name. Falls back to a sentence-cased version of `name`. */
  label?: string | null;
  /** Number: plain/integer/currency/percent. Text: plain/choice/long_text. */
  format?: "plain" | "integer" | "currency" | "percent" | "choice" | "long_text" | null;
  decimals?: number | null;
  currency?: string | null;
  /** Options for a `format: "choice"` text column. */
  options?: string[] | null;
  /** Boolean formula column rendering: a check icon, or a red alert badge. */
  style?: "check" | "alert" | null;
  width?: number | null;
  pinned?: "left" | null;
}

/** A "no two records share this value" rule over one or more of a
 *  template's plain (non-formula) columns. A record where any of the
 *  constraint's columns is blank never conflicts with anything. */
export interface UniqueConstraint {
  name: string;
  columns: string[];
}

export interface TemplateRead {
  id: number;
  name: string;
  columns: TemplateColumn[];
  unique_constraints: UniqueConstraint[];
  created_at: string;
  updated_at: string;
}

export interface TemplateApplyResult {
  status: "applied";
  template: TemplateRead;
}

export interface TemplateWarningResult {
  status: "warning";
  affected_record_count: number;
  reasons: string[];
}

export interface RecordRead {
  id: number;
  template_id: number;
  data: Record<string, unknown>;
  computed: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ImportResult {
  imported_count: number;
  errors: { row_number: number; reason: string }[];
}

export interface SummaryRow {
  /** One entry per group_by column, keyed by column name. */
  group_values: Record<string, unknown>;
  count: number;
  sum: number | null;
}

export type ChartType = "bar" | "line" | "pie" | "area";

export interface SummaryViewRead {
  id: number;
  template_id: number;
  name: string;
  group_by: string[];
  metric: string | null;
  chart_type: ChartType;
  created_at: string;
  updated_at: string;
}
