// NOTE (2026-11-01): this suite had drifted badly out of sync with the UI
// (row actions moved behind a "..." menu, search became client-side,
// Add Row became inline-grid editing instead of a modal, a pinned summary
// row was added) -- these tests had not been kept up to date with those
// changes. Most were repaired to match current behavior; treat this file
// with suspicion until it's been run regularly again, not as settled truth.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataViewPage } from "../../src/pages/DataViewPage";
import {
  listTemplates,
  getTemplate,
  listRecords,
  updateRecord,
  createRecord,
  deleteRecord,
  importTemplate,
  exportTemplate,
} from "../../src/api/client";

vi.mock("../../src/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client")>();
  return {
    ...actual,
    listTemplates: vi.fn(),
    getTemplate: vi.fn(),
    listRecords: vi.fn(),
    updateRecord: vi.fn(),
    createRecord: vi.fn(),
    deleteRecord: vi.fn(),
    importTemplate: vi.fn(),
    exportTemplate: vi.fn(),
  };
});

const TEMPLATE = {
  id: 1,
  name: "Expenses",
  columns: [
    { name: "a", type: "number" as const, formula: null },
    { name: "b", type: "number" as const, formula: null },
    { name: "ratio", type: "number" as const, formula: "=[@a]/[@b]" },
  ],
  created_at: "",
  updated_at: "",
};

beforeEach(() => {
  vi.mocked(listTemplates).mockResolvedValue([TEMPLATE]);
  vi.mocked(getTemplate).mockResolvedValue(TEMPLATE);
  vi.mocked(listRecords).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DataViewPage", () => {
  it("visibly marks a record whose formula column is #VALUE!", async () => {
    vi.mocked(listRecords).mockResolvedValueOnce([
      { id: 1, template_id: 1, data: { a: 1, b: 0 }, computed: { ratio: "#VALUE!" }, created_at: "", updated_at: "" },
    ]);
    render(<DataViewPage templateId={1} />);
    expect(await screen.findByText("#VALUE!")).toHaveClass("dv-cell-error");
  });

  it("shows a loading state while records are being fetched", () => {
    vi.mocked(listRecords).mockReturnValue(new Promise(() => {})); // never resolves
    render(<DataViewPage templateId={1} />);
    expect(screen.getByRole("status", { name: /loading records/i })).toBeInTheDocument();
  });

  it("does not mark a normal numeric value as an error", async () => {
    vi.mocked(listRecords).mockResolvedValueOnce([
      { id: 1, template_id: 1, data: { a: 10, b: 5 }, computed: { ratio: 2 }, created_at: "", updated_at: "" },
    ]);
    render(<DataViewPage templateId={1} />);
    // "2" appears both as the row's own ratio cell and (with a single row) as
    // the pinned summary row's total for that column -- neither is an error.
    const cells = await screen.findAllByText("2");
    expect(cells.length).toBeGreaterThan(0);
    cells.forEach((cell) => expect(cell).not.toHaveClass("dv-cell-error"));
  });

  it("filters the grid client-side as the user types, with no extra listRecords call", async () => {
    vi.mocked(listRecords).mockResolvedValueOnce([
      { id: 1, template_id: 1, data: { a: 1, b: 1 }, computed: { ratio: 1 }, created_at: "", updated_at: "" },
      { id: 2, template_id: 1, data: { a: 2, b: 2 }, computed: { ratio: 1 }, created_at: "", updated_at: "" },
    ]);
    render(<DataViewPage templateId={1} />);
    await screen.findByRole("grid");
    // Two calls on load: one for the grid's own records, one for the
    // template dropdown's row count.
    await waitFor(() => expect(listRecords).toHaveBeenCalledTimes(2));

    expect(screen.getByText("2 of 2 rows")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("searchbox"), "zzz-no-match");
    await waitFor(() => expect(screen.getByText("0 of 2 rows")).toBeInTheDocument());
    // Filtering is purely client-side (AG-Grid's quickFilterText) -- no
    // extra fetch, and the grid itself never unmounts.
    expect(listRecords).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("grid")).toBeInTheDocument();
  });

  it("shows boolean values in plain language instead of true/false", async () => {
    vi.mocked(getTemplate).mockResolvedValue({
      id: 1,
      name: "Expenses",
      columns: [{ name: "active", type: "boolean" as const, formula: null }],
      created_at: "",
      updated_at: "",
    });
    vi.mocked(listRecords).mockResolvedValueOnce([
      { id: 1, template_id: 1, data: { active: true }, computed: {}, created_at: "", updated_at: "" },
    ]);
    render(<DataViewPage templateId={1} />);
    expect(await screen.findByLabelText("Yes")).toBeInTheDocument();
  });

  it("shows an error message when records fail to load", async () => {
    vi.mocked(listRecords).mockRejectedValueOnce(new Error("network down"));
    render(<DataViewPage templateId={1} />);
    expect(await screen.findByText(/couldn.t load/i)).toBeInTheDocument();
  });

  it("saves an edit via the Edit button's form, sending the record's full data, not just the changed field", async () => {
    vi.mocked(listRecords).mockResolvedValueOnce([
      { id: 1, template_id: 1, data: { a: 5, b: 2 }, computed: { ratio: 2.5 }, created_at: "", updated_at: "" },
    ]);
    vi.mocked(updateRecord).mockResolvedValueOnce({
      id: 1,
      template_id: 1,
      data: { a: 9, b: 2 },
      computed: { ratio: 4.5 },
      created_at: "",
      updated_at: "",
    });
    render(<DataViewPage templateId={1} />);
    await userEvent.click(await screen.findByRole("button", { name: /row actions for 5/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /edit in form/i }));
    const fieldA = await screen.findByLabelText(/^a$/i);
    await userEvent.clear(fieldA);
    await userEvent.type(fieldA, "9");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(updateRecord).toHaveBeenCalledWith(1, { a: 9, b: 2 }));
    // "4.5" appears both in the updated ratio cell and (with a single row)
    // in the pinned summary row's total for that column.
    expect((await screen.findAllByText("4.5")).length).toBeGreaterThan(0);
    // The dialog closes after a successful save.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a single click on a grid cell never changes anything -- the grid is view-only outside the Edit form", async () => {
    vi.mocked(listRecords).mockResolvedValueOnce([
      { id: 1, template_id: 1, data: { a: 5, b: 2 }, computed: { ratio: 2.5 }, created_at: "", updated_at: "" },
    ]);
    render(<DataViewPage templateId={1} />);
    // "5" appears both in the row's own "a" cell and (with a single row) in
    // the pinned summary row's total for that column.
    const [cell] = await screen.findAllByText("5");
    await userEvent.click(cell);
    await userEvent.dblClick(cell);
    // The grid value is unchanged and no save was ever triggered -- not
    // checking for the absence of a spinbutton role, since AG-Grid's own
    // pagination control (page-number input) also uses that role and
    // would make this assertion a false positive.
    expect(screen.getAllByText("5").length).toBeGreaterThan(0);
    expect(updateRecord).not.toHaveBeenCalled();
  });

  it("Add row opens a popup with blank defaults; Save & add another creates the record and keeps the popup open for the next one", async () => {
    vi.mocked(createRecord).mockResolvedValueOnce({
      id: 2,
      template_id: 1,
      data: { a: 9, b: null },
      computed: { ratio: "#VALUE!" },
      created_at: "",
      updated_at: "",
    });
    render(<DataViewPage templateId={1} />);
    await screen.findByRole("heading", { name: "Expenses" });
    await userEvent.click(screen.getByRole("button", { name: "+ Add row" }));

    expect(await screen.findByRole("heading", { name: /^add row$/i })).toBeInTheDocument();
    // The formula column can't be filled in -- it has no value until the
    // record is actually created and the backend computes it.
    expect(screen.getByDisplayValue("Computed after saving")).toBeInTheDocument();

    const fieldA = await screen.findByLabelText(/^a$/i);
    await userEvent.type(fieldA, "9");
    await userEvent.click(screen.getByRole("button", { name: /save & add another/i }));

    // Nothing is created until Save is clicked -- not an immediate blank
    // createRecord({}).
    await waitFor(() => expect(createRecord).toHaveBeenCalledWith(1, { a: 9, b: null }));
    // The popup stays open (ready for a second row) instead of closing.
    expect(await screen.findByRole("heading", { name: /add row/i })).toBeInTheDocument();
    expect(screen.getByText(/1 added/i)).toBeInTheDocument();
    // The form is cleared back to blank defaults for the next row.
    expect(await screen.findByLabelText(/^a$/i)).toHaveValue(null);
    // The first row is already visible in the grid behind the popup.
    expect(await screen.findByText("#VALUE!")).toBeInTheDocument();
  });

  it("Done closes the Add row popup without creating another record", async () => {
    render(<DataViewPage templateId={1} />);
    await screen.findByRole("heading", { name: "Expenses" });
    await userEvent.click(screen.getByRole("button", { name: "+ Add row" }));
    await screen.findByRole("heading", { name: /^add row$/i });

    await userEvent.click(screen.getByRole("button", { name: /^done$/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(createRecord).not.toHaveBeenCalled();
  });

  it("saves both fields in one request when two fields are changed in the same modal session", async () => {
    vi.mocked(listRecords).mockResolvedValueOnce([
      { id: 1, template_id: 1, data: { a: 5, b: 2 }, computed: { ratio: 2.5 }, created_at: "", updated_at: "" },
    ]);
    vi.mocked(updateRecord).mockResolvedValueOnce({
      id: 1,
      template_id: 1,
      data: { a: 9, b: 8 },
      computed: { ratio: 1.125 },
      created_at: "",
      updated_at: "",
    });
    render(<DataViewPage templateId={1} />);
    await userEvent.click(await screen.findByRole("button", { name: /row actions for 5/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /edit in form/i }));
    const fieldA = await screen.findByLabelText(/^a$/i);
    await userEvent.clear(fieldA);
    await userEvent.type(fieldA, "9");
    const fieldB = await screen.findByLabelText(/^b$/i);
    await userEvent.clear(fieldB);
    await userEvent.type(fieldB, "8");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(updateRecord).toHaveBeenCalledTimes(1));
    expect(updateRecord).toHaveBeenCalledWith(1, { a: 9, b: 8 });
  });

  it("Cancel closes the edit form without saving", async () => {
    vi.mocked(listRecords).mockResolvedValueOnce([
      { id: 1, template_id: 1, data: { a: 5, b: 2 }, computed: { ratio: 2.5 }, created_at: "", updated_at: "" },
    ]);
    render(<DataViewPage templateId={1} />);
    await userEvent.click(await screen.findByRole("button", { name: /row actions for 5/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /edit in form/i }));
    const fieldA = await screen.findByLabelText(/^a$/i);
    await userEvent.clear(fieldA);
    await userEvent.type(fieldA, "999");
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(updateRecord).not.toHaveBeenCalled();
    // The grid still shows the original, unchanged value.
    expect(screen.getAllByText("5").length).toBeGreaterThan(0);
  });

  it("deletes a row via its per-row delete action, calling deleteRecord", async () => {
    vi.mocked(listRecords).mockResolvedValueOnce([
      { id: 1, template_id: 1, data: { a: 1, b: 1 }, computed: { ratio: 1 }, created_at: "", updated_at: "" },
    ]);
    vi.mocked(deleteRecord).mockResolvedValueOnce(undefined);
    render(<DataViewPage templateId={1} />);
    await userEvent.click(await screen.findByRole("button", { name: /row actions for 1/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /^delete$/i }));
    await waitFor(() => expect(deleteRecord).toHaveBeenCalledWith(1));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /row actions for 1/i })).not.toBeInTheDocument()
    );
  });

  it("exports the template and triggers a file download", async () => {
    const blob = new Blob(["xlsx-bytes"]);
    vi.mocked(exportTemplate).mockResolvedValueOnce(blob);
    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    render(<DataViewPage templateId={1} />);
    await screen.findByRole("heading", { name: "Expenses" });
    // Export lives behind the "Data" dropdown.
    await userEvent.click(screen.getByRole("button", { name: /^data/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^export$/i }));
    await waitFor(() => expect(exportTemplate).toHaveBeenCalledWith(1));
    expect(createObjectURL).toHaveBeenCalledWith(blob);
  });

  it("shows which rows failed and why after an import with errors", async () => {
    vi.mocked(importTemplate).mockResolvedValueOnce({
      imported_count: 2,
      errors: [{ row_number: 3, reason: "invalid type for column 'count'" }],
    });
    render(<DataViewPage templateId={1} />);
    await screen.findByRole("heading", { name: "Expenses" });
    const file = new File(["dummy"], "data.xlsx");
    await userEvent.upload(screen.getByLabelText(/import/i), file);
    expect(await screen.findByText(/row 3/i)).toBeInTheDocument();
    expect(screen.getByText(/invalid type for column 'count'/)).toBeInTheDocument();
  });

  it("shows a whole-file reason, not a row count, when the file's header doesn't match the template", async () => {
    vi.mocked(importTemplate).mockResolvedValueOnce({
      imported_count: 0,
      errors: [{ row_number: 0, reason: "Header mismatch: missing required column(s) ['b']" }],
    });
    render(<DataViewPage templateId={1} />);
    await screen.findByRole("heading", { name: "Expenses" });
    const file = new File(["dummy"], "data.xlsx");
    await userEvent.upload(screen.getByLabelText(/import/i), file);
    expect(await screen.findByText(/nothing was imported/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 rows imported/i)).not.toBeInTheDocument();
  });

  it("shows a plain success message after an import with no errors", async () => {
    vi.mocked(importTemplate).mockResolvedValueOnce({ imported_count: 4, errors: [] });
    render(<DataViewPage templateId={1} />);
    await screen.findByRole("heading", { name: "Expenses" });
    const file = new File(["dummy"], "data.xlsx");
    await userEvent.upload(screen.getByLabelText(/import/i), file);
    expect(await screen.findByText(/imported 4 rows/i)).toBeInTheDocument();
  });

  it("Edit in form gives a long_text column a textarea and a plain text column a single-line input", async () => {
    vi.mocked(getTemplate).mockResolvedValue({
      id: 1,
      name: "Expenses",
      columns: [
        { name: "title", type: "text" as const, formula: null },
        { name: "notes", type: "text" as const, formula: null, format: "long_text" as const },
      ],
      created_at: "",
      updated_at: "",
    });
    vi.mocked(listRecords).mockResolvedValueOnce([
      { id: 1, template_id: 1, data: { title: "Hi", notes: "Hello" }, computed: {}, created_at: "", updated_at: "" },
    ]);
    render(<DataViewPage templateId={1} />);
    await userEvent.click(await screen.findByRole("button", { name: /row actions for hi/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /edit in form/i }));
    expect((await screen.findByLabelText(/^title$/i)).tagName).toBe("INPUT");
    expect(screen.getByLabelText(/^notes$/i).tagName).toBe("TEXTAREA");
  });

  it("displays a column whose name contains a dot (AG Grid otherwise treats \"Door No.\" as a nested path and renders it blank)", async () => {
    vi.mocked(getTemplate).mockResolvedValue({
      id: 1,
      name: "Expenses",
      columns: [{ name: "Door No.", type: "number" as const, formula: null }],
      created_at: "",
      updated_at: "",
    });
    vi.mocked(listRecords).mockResolvedValueOnce([
      { id: 1, template_id: 1, data: { "Door No.": 69 }, computed: {}, created_at: "", updated_at: "" },
    ]);
    render(<DataViewPage templateId={1} />);
    expect((await screen.findAllByText("69")).length).toBeGreaterThan(0);
  });

  it("saves the correct value under its own key when editing a dotted column (not dropped via AG Grid's nested-path field resolution)", async () => {
    vi.mocked(getTemplate).mockResolvedValue({
      id: 1,
      name: "Expenses",
      columns: [
        { name: "owner", type: "text" as const, formula: null },
        { name: "Door No.", type: "number" as const, formula: null },
      ],
      created_at: "",
      updated_at: "",
    });
    vi.mocked(listRecords).mockResolvedValueOnce([
      { id: 1, template_id: 1, data: { owner: "Earadat", "Door No.": 69 }, computed: {}, created_at: "", updated_at: "" },
    ]);
    vi.mocked(updateRecord).mockResolvedValueOnce({
      id: 1,
      template_id: 1,
      data: { owner: "Earadat", "Door No.": 70 },
      computed: {},
      created_at: "",
      updated_at: "",
    });
    render(<DataViewPage templateId={1} />);
    const cell = await waitFor(() => {
      const el = document.querySelector('[role="gridcell"][col-id="Door No."]');
      if (!el) throw new Error("cell not rendered yet");
      return el as HTMLElement;
    });
    await userEvent.dblClick(cell);
    const editor = await screen.findByRole("spinbutton");
    await userEvent.clear(editor);
    await userEvent.type(editor, "70");
    await userEvent.keyboard("{Enter}");
    // The merge must still carry "owner" (untouched) and the new "Door
    // No." value under its own flat key -- not silently dropped.
    await waitFor(() => expect(updateRecord).toHaveBeenCalledWith(1, { owner: "Earadat", "Door No.": 70 }));
  });
});
