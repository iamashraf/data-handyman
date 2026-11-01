import type { TemplateColumn } from "../api/types";
import { formatDisplayDate, parseIsoDate } from "./dateParser";

/** Default display label when a column has no explicit `label`:
 *  "unit_price" -> "Unit price", "field_02_number" -> "Field 02 number". */
export function defaultLabel(name: string): string {
  const words = name.split(/[_\s]+/).filter(Boolean);
  if (words.length === 0) return name;
  return words
    .map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}

export function columnLabel(column: TemplateColumn): string {
  return column.label ?? defaultLabel(column.name);
}

const CHOICE_TINTS = ["tint-0", "tint-1", "tint-2", "tint-3", "tint-4", "tint-5"];

export function choiceTintClass(column: TemplateColumn, option: string): string {
  const options = column.options ?? [];
  const index = options.indexOf(option);
  return CHOICE_TINTS[((index < 0 ? 0 : index) % CHOICE_TINTS.length)];
}

/** True when a boolean formula column should render as a red text badge
 *  instead of a check icon -- either an explicit `style: "alert"`, or (for
 *  a column with no explicit style) a name/label that reads as a warning. */
export function isAlertBoolean(column: TemplateColumn): boolean {
  if (column.style === "alert") return true;
  if (column.style === "check") return false;
  const haystack = `${column.name} ${column.label ?? ""}`.toLowerCase();
  return /overdue|low_stock|low stock|alert|warning/.test(haystack);
}

export function formatNumberValue(value: unknown, column: TemplateColumn): string {
  if (value == null || typeof value !== "number" || Number.isNaN(value)) {
    return "";
  }
  const decimals = column.decimals ?? (column.format === "integer" ? 0 : column.format === "percent" ? 1 : 2);
  switch (column.format) {
    case "currency": {
      const currency = column.currency ?? "USD";
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: column.decimals ?? 2,
        maximumFractionDigits: column.decimals ?? 2,
      }).format(value);
    }
    case "percent":
      return new Intl.NumberFormat("en-US", {
        style: "percent",
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(value);
    case "integer":
      return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(value));
    default:
      return new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(value);
  }
}

export function formatDateValue(value: unknown): string {
  if (value == null || typeof value !== "string") return "";
  const parsed = parseIsoDate(value);
  return parsed ? formatDisplayDate(parsed) : value;
}

export function isNumericFormat(column: TemplateColumn): boolean {
  return column.type === "number";
}

/** Columns whose values this app sums in the grid's pinned summary row. */
export function isSummableFormat(column: TemplateColumn): boolean {
  return column.type === "number" && (column.format === "currency" || column.format === "integer" || column.format == null || column.format === "plain");
}
