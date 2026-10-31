import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataViewPage } from "../../src/pages/DataViewPage";
import { listTemplates, getTemplate, listRecords } from "../../src/api/client";

vi.mock("../../src/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client")>();
  return {
    ...actual,
    listTemplates: vi.fn(),
    getTemplate: vi.fn(),
    listRecords: vi.fn(),
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
});
