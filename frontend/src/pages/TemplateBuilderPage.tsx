import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import {
  ApiError,
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
} from "../api/client";
import type { TemplateColumn, TemplateRead, TemplateWarningResult } from "../api/types";
import "./TemplateBuilderPage.css";

interface TemplateBuilderPageProps {
  templateId?: number;
}

interface ColumnDraft {
  name: string;
  type: TemplateColumn["type"];
  formula: string;
  /** Text columns only: a bigger, multi-line editor (grid popup + "Edit in
   *  form" textarea) instead of the single-line default -- for a column
   *  like "Notes" as opposed to one like "Task name". */
  longText: boolean;
}

const COLUMN_TYPE_LABELS: Record<TemplateColumn["type"], string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  boolean: "Yes/No",
};

function emptyColumn(): ColumnDraft {
  return { name: "", type: "text", formula: "", longText: false };
}

function toDrafts(columns: TemplateColumn[]): ColumnDraft[] {
  return columns.map((c) => ({
    name: c.name,
    type: c.type,
    formula: c.formula ?? "",
    longText: c.format === "long_text",
  }));
}

function toColumns(drafts: ColumnDraft[]): TemplateColumn[] {
  return drafts.map((d) => ({
    name: d.name,
    type: d.type,
    formula: d.formula.trim() === "" ? null : d.formula,
    format: d.type === "text" && d.longText ? "long_text" : null,
  }));
}

/** Turns an ApiError's body into a message a non-technical user can read. */
function describeApiError(error: ApiError): string {
  const body = error.body;
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") {
      return detail;
    }
    if (Array.isArray(detail)) {
      const messages = detail
        .map((item) => (item && typeof item === "object" && "msg" in item ? String((item as { msg: unknown }).msg) : null))
        .filter((m): m is string => m !== null);
      if (messages.length > 0) {
        return messages.join("; ");
      }
    }
  }
  return "Something went wrong while saving. Please try again.";
}

export function TemplateBuilderPage({ templateId }: TemplateBuilderPageProps) {
  const [templates, setTemplates] = useState<TemplateRead[]>([]);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | undefined>(templateId);
  const [name, setName] = useState("");
  const [columns, setColumns] = useState<ColumnDraft[]>([]);
  const [warning, setWarning] = useState<TemplateWarningResult | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const wasWarningOpen = useRef(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listTemplates()
      .then((result) => {
        if (!Array.isArray(result)) {
          setTemplatesError("Couldn't load your templates. Check your connection and try again.");
          return;
        }
        setTemplates(result);
      })
      .catch(() => setTemplatesError("Couldn't load your templates. Check your connection and try again."));
  }, []);

  useEffect(() => {
    if (selectedId == null) {
      setName("");
      setColumns([]);
      return;
    }
    getTemplate(selectedId)
      .then((t) => {
        setName(t.name);
        setColumns(toDrafts(t.columns));
      })
      .catch(() => setSaveError("Couldn't load this template. Check your connection and try again."));
  }, [selectedId]);

  // Move focus with the dialog: into it on open, back to Save on any close
  // (cancel, a successful confirm, or a confirm that errors).
  useEffect(() => {
    if (warning) {
      wasWarningOpen.current = true;
      cancelButtonRef.current?.focus();
    } else if (wasWarningOpen.current) {
      wasWarningOpen.current = false;
      saveButtonRef.current?.focus();
    }
  }, [warning]);

  useEffect(() => {
    if (!dropdownOpen) return;
    function handleOutsideClick(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [dropdownOpen]);

  function clearStatus() {
    setStatusMessage(null);
  }

  function handleSelect(id: number) {
    setSelectedId(id);
    setWarning(null);
    setSaveError(null);
    setDropdownOpen(false);
    clearStatus();
  }

  function handleNew() {
    setSelectedId(undefined);
    setWarning(null);
    setSaveError(null);
    setDropdownOpen(false);
    clearStatus();
  }

  async function handleDelete() {
    if (selectedId == null) return;
    const current = templates.find((t) => t.id === selectedId);
    const templateName = current?.name ?? name;
    // Deleting a template also deletes all of its records (no undo) --
    // confirm before doing something this permanent.
    const confirmed = window.confirm(
      `Delete "${templateName}" and all of its records? This can't be undone.`
    );
    if (!confirmed) {
      return;
    }
    setDeleting(true);
    setSaveError(null);
    try {
      await deleteTemplate(selectedId);
      setTemplates((prev) => prev.filter((t) => t.id !== selectedId));
      handleNew();
    } catch (error) {
      setSaveError(
        error instanceof ApiError ? describeApiError(error) : "Couldn't delete this template. Check your connection and try again."
      );
    } finally {
      setDeleting(false);
    }
  }

  function updateColumn(index: number, patch: Partial<ColumnDraft>) {
    setColumns((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
    clearStatus();
  }

  function addColumn() {
    setColumns((prev) => [...prev, emptyColumn()]);
    clearStatus();
  }

  function removeColumn(index: number) {
    setColumns((prev) => prev.filter((_, i) => i !== index));
    clearStatus();
  }

  async function save(force: boolean) {
    setSaving(true);
    setSaveError(null);
    clearStatus();
    try {
      const input = { name, columns: toColumns(columns) };
      if (selectedId == null) {
        const created = await createTemplate(input);
        setSelectedId(created.id);
        setTemplates((prev) => [...prev, created]);
        setWarning(null);
        setStatusMessage("Template saved.");
      } else {
        const result = await updateTemplate(selectedId, force ? { ...input, force: true } : input);
        if (result.status === "warning") {
          setWarning(result);
        } else {
          setWarning(null);
          setTemplates((prev) => prev.map((t) => (t.id === result.template.id ? result.template : t)));
          setStatusMessage("Template saved.");
        }
      }
    } catch (error) {
      // Close the dialog (if open) so the error is visible instead of
      // hidden behind it — a rejected "confirm and save" must not look
      // like nothing happened.
      setWarning(null);
      setSaveError(error instanceof ApiError ? describeApiError(error) : "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save(false);
  }

  function handleCancelWarning() {
    setWarning(null);
  }

  function handleConfirmWarning() {
    save(true);
  }

  function handleDialogKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      handleCancelWarning();
    }
  }

  const recordWord = (count: number) => (count === 1 ? "record" : "records");
  const columnWord = (count: number) => (count === 1 ? "column" : "columns");
  const selectedTemplate = templates.find((t) => t.id === selectedId);

  return (
    <div className="dv-page">
      <div className="dv-topbar">
        <div className="dv-title-group">
          <h2>{selectedId == null ? "New template" : selectedTemplate?.name ?? "Edit template"}</h2>
          {selectedId != null ? <span className="dv-row-count">· {columns.length} {columnWord(columns.length)}</span> : null}
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
              <span className="dv-template-dropdown-button-label">
                {selectedTemplate ? selectedTemplate.name : "Select a template"}
              </span>
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
                    <span className="dv-template-dropdown-count">
                      {t.columns.length} {columnWord(t.columns.length)}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button type="button" className="dv-toolbar-button dv-new-button" onClick={handleNew}>
            + New
          </button>
        </div>
      </div>

      {templatesError ? <p className="dv-error">{templatesError}</p> : null}

      <div className="tb-body">
        <form onSubmit={handleSubmit}>
          <div className="tb-field">
            <label htmlFor="template-name">Template name</label>
            <input
              id="template-name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                clearStatus();
              }}
            />
          </div>

          <h3 className="tb-columns-heading">Columns</h3>

          {columns.length === 0 ? (
            <div className="empty-state tb-empty-columns">
              <p>No columns yet</p>
              <div className="empty-state-actions">
                <button type="button" className="btn btn-primary" onClick={addColumn}>
                  + Add column
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="tb-table-wrap">
                <table className="tb-table">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Column name</th>
                      <th scope="col">Type</th>
                      <th scope="col">Long text</th>
                      <th scope="col">Formula (optional)</th>
                      <th scope="col">Remove</th>
                    </tr>
                  </thead>
                  <tbody>
                    {columns.map((col, index) => (
                      <tr key={index}>
                        <td className="tb-row-index">{index + 1}</td>
                        <td>
                          <input
                            type="text"
                            aria-label={`Column ${index + 1} name`}
                            value={col.name}
                            onChange={(e) => updateColumn(index, { name: e.target.value })}
                          />
                        </td>
                        <td>
                          <select
                            aria-label={`Column ${index + 1} type`}
                            value={col.type}
                            onChange={(e) => updateColumn(index, { type: e.target.value as TemplateColumn["type"] })}
                          >
                            {Object.entries(COLUMN_TYPE_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Column ${index + 1} long text`}
                            checked={col.longText}
                            disabled={col.type !== "text"}
                            onChange={(e) => updateColumn(index, { longText: e.target.checked })}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            className="tb-formula-input"
                            aria-label={`Column ${index + 1} formula`}
                            placeholder="e.g. =[@qty]*[@price]"
                            value={col.formula}
                            onChange={(e) => updateColumn(index, { formula: e.target.value })}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="tb-remove-column"
                            aria-label={`Remove column ${index + 1}`}
                            onClick={() => removeColumn(index)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" className="tb-add-column" onClick={addColumn}>
                + Add column
              </button>
            </>
          )}

          {statusMessage ? (
            <p role="status" className="tb-status">
              {statusMessage}
            </p>
          ) : null}
          {saveError ? <p className="dv-error">{saveError}</p> : null}

          <div className="tb-actions">
            {selectedId != null ? (
              <button type="button" className="btn btn-danger-outline" onClick={handleDelete} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete template"}
              </button>
            ) : null}
            <div className="tb-actions-spacer" />
            <button type="submit" className="tb-save" ref={saveButtonRef} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>

      {warning ? (
        <div className="tb-overlay" onKeyDown={handleDialogKeyDown}>
          <div
            className="tb-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="tb-warning-title"
            aria-describedby="tb-warning-count"
          >
            <h2 id="tb-warning-title">This will affect existing records</h2>
            <p id="tb-warning-count">
              This change affects {warning.affected_record_count} existing {recordWord(warning.affected_record_count)}.
            </p>
            <ul>
              {warning.reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
            <p>Review this, then confirm to save anyway, or cancel to keep your current template as it is.</p>
            <div className="tb-dialog-actions">
              <button type="button" className="tb-cancel" ref={cancelButtonRef} onClick={handleCancelWarning}>
                Cancel
              </button>
              <button type="button" className="tb-confirm" onClick={handleConfirmWarning} disabled={saving}>
                Confirm and save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
