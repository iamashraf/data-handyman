import { addDays, addMonths, addWeeks, format, isMatch, isValid, parse, setYear } from "date-fns";

/**
 * Formats tried in order against typed free text; the first one `isMatch`
 * accepts wins. "M/d/yy" must come before "M/d/yyyy" -- date-fns's isMatch
 * also accepts a 2-digit year against the "yyyy" token (parsing it as that
 * literal year, e.g. 26 AD), so a 4-digit-year format listed first would
 * shadow the 2-digit case below it. The rest don't overlap.
 */
const ABSOLUTE_FORMATS = [
  "yyyy-MM-dd",
  "M/d/yy",
  "M/d/yyyy",
  "M-d-yyyy",
  "M/d",
  "MMM d, yyyy",
  "MMM d yyyy",
  "MMM d",
  "MMMM d, yyyy",
  "MMMM d yyyy",
  "MMMM d",
  "d MMM yyyy",
  "d MMMM yyyy",
];

const RELATIVE_UNIT_PATTERN = /^([+-]\d+)([dwm]?)$/i;

/** Parses whatever a user typed into a date field, per the app's typing
 *  rules: ISO, US-order slash/dash dates (2 or 4 digit year), a bare
 *  "month/day" for the current year, a month name in either order, the
 *  words today/tomorrow/yesterday, and a relative offset like "+3d"/"-2w"
 *  (days by default, or d/w/m).
 *
 *  Returns null for text that doesn't match any of the above -- the
 *  caller is responsible for telling the user it's not a valid date and
 *  leaving their text alone, never silently changing it.
 */
export function parseTypedDate(input: string, referenceDate: Date = new Date()): Date | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const lowered = trimmed.toLowerCase();
  if (lowered === "today") {
    return referenceDate;
  }
  if (lowered === "tomorrow") {
    return addDays(referenceDate, 1);
  }
  if (lowered === "yesterday") {
    return addDays(referenceDate, -1);
  }

  const relativeMatch = lowered.match(RELATIVE_UNIT_PATTERN);
  if (relativeMatch) {
    const amount = Number.parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2] || "d";
    if (unit === "w") {
      return addWeeks(referenceDate, amount);
    }
    if (unit === "m") {
      return addMonths(referenceDate, amount);
    }
    return addDays(referenceDate, amount);
  }

  for (const dateFormat of ABSOLUTE_FORMATS) {
    if (!isMatch(trimmed, dateFormat)) {
      continue;
    }
    let parsed = parse(trimmed, dateFormat, referenceDate);
    if (dateFormat === "M/d/yy" && parsed.getFullYear() < 100) {
      parsed = setYear(parsed, parsed.getFullYear() + 2000);
    }
    if (isValid(parsed)) {
      return parsed;
    }
  }

  return null;
}

/** Always-stored form: ISO yyyy-mm-dd. */
export function toIsoDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/** Always-displayed form, e.g. "Nov 15, 2026". */
export function formatDisplayDate(date: Date): string {
  return format(date, "MMM d, yyyy");
}

/** The small muted "confirm before committing" preview text, e.g.
 *  "Sun, Nov 15, 2026". */
export function formatPreviewDate(date: Date): string {
  return format(date, "EEE, MMM d, yyyy");
}

/** Parses an ISO yyyy-mm-dd string (the stored form) back into a Date,
 *  for seeding an editor's initial text from a stored value. */
export function parseIsoDate(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return null;
  }
  const parsed = parse(iso, "yyyy-MM-dd", new Date());
  return isValid(parsed) ? parsed : null;
}
