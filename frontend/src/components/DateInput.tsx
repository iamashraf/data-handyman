import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  addMonths,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
} from "date-fns";
import { formatDisplayDate, formatPreviewDate, parseIsoDate, parseTypedDate, toIsoDate } from "../lib/dateParser";
import "./DateInput.css";

interface DateInputProps {
  value: string | null;
  onChange: (iso: string | null) => void;
  ariaLabel?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Called after a value-changing commit (Enter, Tab, blur, or a calendar
   *  pick) -- the grid cell editor uses this to stop editing. */
  onCommit?: () => void;
}

function textForValue(value: string | null): string {
  if (!value) return "";
  const parsed = parseIsoDate(value);
  return parsed ? formatDisplayDate(parsed) : value;
}

function buildCalendarDays(monthAnchor: Date): Date[] {
  const start = startOfWeek(startOfMonth(monthAnchor));
  const end = endOfWeek(endOfMonth(monthAnchor));
  const days: Date[] = [];
  let cursor = start;
  while (cursor <= end) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

/** Shared date entry control: typing is the primary path (parsed on blur/
 *  Enter/Tab via `parseTypedDate`), the calendar icon is a secondary
 *  helper. Used in the grid (as a cell editor), the edit-in-form dialog,
 *  and date range filters -- one parsing/display contract everywhere a
 *  date is entered. */
export function DateInput({ value, onChange, ariaLabel, placeholder, autoFocus, onCommit }: DateInputProps) {
  const [text, setText] = useState(() => textForValue(value));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [monthAnchor, setMonthAnchor] = useState(() => parseIsoDate(value ?? "") ?? new Date());
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setText(textForValue(value));
  }, [value]);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
    // Only on mount -- this is the "cursor in the text box with the
    // current value selected" behavior from opening a cell editor, not a
    // re-select on every value change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!calendarOpen) return;
    function handleOutsideClick(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setCalendarOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [calendarOpen]);

  const trimmed = text.trim();
  const parsed = trimmed ? parseTypedDate(trimmed) : null;
  const isInvalid = trimmed.length > 0 && parsed === null;

  function commit() {
    if (!trimmed) {
      onChange(null);
      onCommit?.();
      return;
    }
    if (parsed) {
      onChange(toIsoDate(parsed));
      onCommit?.();
    }
    // Invalid text is left exactly as typed, per the typing rules — never
    // silently changed, and never saved.
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      if (calendarOpen) {
        event.preventDefault();
        setCalendarOpen(false);
      }
    } else if (event.key === "ArrowDown" && event.altKey) {
      event.preventDefault();
      setMonthAnchor(parsed ?? new Date());
      setCalendarOpen(true);
    }
  }

  function handlePick(day: Date) {
    const iso = toIsoDate(day);
    setText(formatDisplayDate(day));
    onChange(iso);
    setCalendarOpen(false);
    onCommit?.();
  }

  const days = buildCalendarDays(monthAnchor);

  return (
    <div className="di-root" ref={rootRef}>
      <div className="di-input-row">
        <input
          ref={inputRef}
          type="text"
          className={isInvalid ? "di-input di-input-invalid" : "di-input"}
          value={text}
          placeholder={placeholder ?? "e.g. Nov 15, 2026"}
          aria-label={ariaLabel}
          aria-invalid={isInvalid || undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className="di-calendar-button"
          aria-label={ariaLabel ? `Open calendar for ${ariaLabel}` : "Open calendar"}
          tabIndex={-1}
          onClick={() => {
            setMonthAnchor(parsed ?? new Date());
            setCalendarOpen((open) => !open);
          }}
        >
          📅
        </button>
      </div>
      {isInvalid ? (
        <p className="di-hint di-hint-error">Not a valid date</p>
      ) : parsed ? (
        <p className="di-hint">{formatPreviewDate(parsed)}</p>
      ) : null}

      {calendarOpen ? (
        <div className="di-calendar" role="dialog" aria-label="Choose a date">
          <div className="di-calendar-header">
            <button type="button" aria-label="Previous month" onClick={() => setMonthAnchor((m) => addMonths(m, -1))}>
              ‹
            </button>
            <span>{format(monthAnchor, "MMMM yyyy")}</span>
            <button type="button" aria-label="Next month" onClick={() => setMonthAnchor((m) => addMonths(m, 1))}>
              ›
            </button>
          </div>
          <div className="di-calendar-weekdays">
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>
          <div className="di-calendar-grid">
            {days.map((day) => (
              <button
                type="button"
                key={day.toISOString()}
                className={
                  "di-calendar-day" +
                  (isSameMonth(day, monthAnchor) ? "" : " di-calendar-day-muted") +
                  (parsed && isSameDay(day, parsed) ? " di-calendar-day-selected" : "")
                }
                onClick={() => handlePick(day)}
              >
                {format(day, "d")}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
