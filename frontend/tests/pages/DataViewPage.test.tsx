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
    expect(await screen.findByText("#VALUE!")).toHaveAttribute("data-error", "true");
  });

  it("shows a loading state while records are being fetched", () => {
    vi.mocked(listRecords).mockReturnValue(new Promise(() => {})); // never resolves
    render(<DataViewPage templateId={1} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("does not mark a normal numeric value as an error", async () => {
    vi.mocked(listRecords).mockResolvedValueOnce([
      { id: 1, template_id: 1, data: { a: 10, b: 5 }, computed: { ratio: 2 }, created_at: "", updated_at: "" },
    ]);
    render(<DataViewPage templateId={1} />);
    const cell = await screen.findByText("2");
    expect(cell).not.toHaveAttribute("data-error", "true");
  });

  it("calls listRecords with the search query as the user types, debounced", async () => {
    render(<DataViewPage templateId={1} />);
    await screen.findByRole("searchbox");
    await userEvent.type(screen.getByRole("searchbox"), "foo");
    await waitFor(() => expect(listRecords).toHaveBeenLastCalledWith(1, "foo"), { timeout: 1000 });
  });

  it("keeps the grid mounted (no loading flash) while a search re-fetch is in flight", async () => {
    vi.mocked(listRecords).mockResolvedValueOnce([
      { id: 1, template_id: 1, data: { a: 1, b: 1 }, computed: { ratio: 1 }, created_at: "", updated_at: "" },
    ]);
    render(<DataViewPage templateId={1} />);
    await screen.findByRole("grid");

    vi.mocked(listRecords).mockReturnValue(new Promise(() => {})); // the search fetch never resolves
    await userEvent.type(screen.getByRole("searchbox"), "x");
    await waitFor(() => expect(listRecords).toHaveBeenCalledTimes(2), { timeout: 1000 });

    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(screen.getByText(/searching/i)).toBeInTheDocument();
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
    expect(await screen.findByText("Yes")).toBeInTheDocument();
  });

  it("shows an error message when records fail to load", async () => {
    vi.mocked(listRecords).mockRejectedValueOnce(new Error("network down"));
    render(<DataViewPage templateId={1} />);
    expect(await screen.findByText(/couldn.t load/i)).toBeInTheDocument();
  });

  it("saves an inline edit by sending the record's full data, not just the changed field", async () => {
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
    const cell = await screen.findByText("5");
    await userEvent.dblClick(cell);
    const editor = await screen.findByRole("spinbutton");
    await userEvent.clear(editor);
    await userEvent.type(editor, "9");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(updateRecord).toHaveBeenCalledWith(1, { a: 9, b: 2 }));
    expect(await screen.findByText("4.5")).toBeInTheDocument();
  });

  it("saves an inline edit on a row created via Add row (the row didn't exist in records state at mount)", async () => {
    vi.mocked(createRecord).mockResolvedValueOnce({
      id: 2,
      template_id: 1,
      data: {},
      computed: { ratio: "#VALUE!" },
      created_at: "",
      updated_at: "",
    });
    vi.mocked(updateRecord).mockResolvedValueOnce({
      id: 2,
      template_id: 1,
      data: { a: 9, b: null },
      computed: { ratio: "#VALUE!" },
      created_at: "",
      updated_at: "",
    });
    render(<DataViewPage templateId={1} />);
    await screen.findByRole("grid");
    await userEvent.click(screen.getByRole("button", { name: /add row/i }));
    await waitFor(() => expect(createRecord).toHaveBeenCalledWith(1, {}));

    // Column order is a, b, ratio, then the trailing delete-action column.
    const cells = await screen.findAllByRole("gridcell");
    await userEvent.dblClick(cells[0]);
    const editor = await screen.findByRole("spinbutton");
    await userEvent.type(editor, "9");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(updateRecord).toHaveBeenCalledWith(2, expect.objectContaining({ a: 9 })));
  });

  it("keeps an edited field's new value when a second field on the same row is edited before the first save resolves", async () => {
    vi.mocked(listRecords).mockResolvedValueOnce([
      { id: 1, template_id: 1, data: { a: 5, b: 2 }, computed: { ratio: 2.5 }, created_at: "", updated_at: "" },
    ]);
    let resolveFirstSave!: (value: Awaited<ReturnType<typeof updateRecord>>) => void;
    vi.mocked(updateRecord).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstSave = resolve;
        })
    );
    vi.mocked(updateRecord).mockResolvedValueOnce({
      id: 1,
      template_id: 1,
      data: { a: 9, b: 8 },
      computed: { ratio: 1.125 },
      created_at: "",
      updated_at: "",
    });

    render(<DataViewPage templateId={1} />);
    const cellA = await screen.findByText("5");
    await userEvent.dblClick(cellA);
    const editorA = await screen.findByRole("spinbutton");
    await userEvent.clear(editorA);
    await userEvent.type(editorA, "9");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(updateRecord).toHaveBeenCalledTimes(1)); // first save still in flight, unresolved

    const cellB = await screen.findByText("2");
    await userEvent.dblClick(cellB);
    const editorB = await screen.findByRole("spinbutton");
    await userEvent.clear(editorB);
    await userEvent.type(editorB, "8");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(updateRecord).toHaveBeenCalledTimes(2));
    // The second save must carry the first edit's new value (a: 9), not
    // the pre-edit value still sitting in `records` state at this point.
    expect(updateRecord).toHaveBeenNthCalledWith(2, 1, expect.objectContaining({ a: 9, b: 8 }));

    resolveFirstSave({
      id: 1,
      template_id: 1,
      data: { a: 9, b: 2 },
      computed: { ratio: 4.5 },
      created_at: "",
      updated_at: "",
    });
  });

  it("adds a new row via the Add row action, calling createRecord", async () => {
    vi.mocked(createRecord).mockResolvedValueOnce({
      id: 2,
      template_id: 1,
      data: {},
      computed: { ratio: "#VALUE!" },
      created_at: "",
      updated_at: "",
    });
    render(<DataViewPage templateId={1} />);
    await screen.findByRole("grid");
    await userEvent.click(screen.getByRole("button", { name: /add row/i }));
    await waitFor(() => expect(createRecord).toHaveBeenCalledWith(1, {}));
    expect(await screen.findByText("#VALUE!")).toBeInTheDocument();
  });

  it("deletes a row via its per-row delete action, calling deleteRecord", async () => {
    vi.mocked(listRecords).mockResolvedValueOnce([
      { id: 1, template_id: 1, data: { a: 1, b: 1 }, computed: { ratio: 1 }, created_at: "", updated_at: "" },
    ]);
    vi.mocked(deleteRecord).mockResolvedValueOnce(undefined);
    render(<DataViewPage templateId={1} />);
    const deleteButton = await screen.findByRole("button", { name: /delete row 1/i });
    await userEvent.click(deleteButton);
    await waitFor(() => expect(deleteRecord).toHaveBeenCalledWith(1));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /delete row 1/i })).not.toBeInTheDocument()
    );
  });

  it("exports the template and triggers a file download", async () => {
    const blob = new Blob(["xlsx-bytes"]);
    vi.mocked(exportTemplate).mockResolvedValueOnce(blob);
    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    render(<DataViewPage templateId={1} />);
    await screen.findByRole("grid");
    await userEvent.click(screen.getByRole("button", { name: /^export$/i }));
    await waitFor(() => expect(exportTemplate).toHaveBeenCalledWith(1));
    expect(createObjectURL).toHaveBeenCalledWith(blob);
  });

  it("shows which rows failed and why after an import with errors", async () => {
    vi.mocked(importTemplate).mockResolvedValueOnce({
      imported_count: 2,
      errors: [{ row_number: 3, reason: "invalid type for column 'count'" }],
    });
    render(<DataViewPage templateId={1} />);
    await screen.findByRole("grid");
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
    await screen.findByRole("grid");
    const file = new File(["dummy"], "data.xlsx");
    await userEvent.upload(screen.getByLabelText(/import/i), file);
    expect(await screen.findByText(/nothing was imported/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 rows imported/i)).not.toBeInTheDocument();
  });

  it("shows a plain success message after an import with no errors", async () => {
    vi.mocked(importTemplate).mockResolvedValueOnce({ imported_count: 4, errors: [] });
    render(<DataViewPage templateId={1} />);
    await screen.findByRole("grid");
    const file = new File(["dummy"], "data.xlsx");
    await userEvent.upload(screen.getByLabelText(/import/i), file);
    expect(await screen.findByText(/imported 4 rows/i)).toBeInTheDocument();
  });
});
