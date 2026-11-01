import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SummaryViewPage } from "../../src/pages/SummaryViewPage";
import { listTemplates, getTemplate, getSummary, exportTemplate } from "../../src/api/client";
import type { SummaryRow } from "../../src/api/types";

vi.mock("../../src/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client")>();
  return {
    ...actual,
    listTemplates: vi.fn(),
    getTemplate: vi.fn(),
    getSummary: vi.fn(),
    exportTemplate: vi.fn(),
  };
});

const TEMPLATE = {
  id: 1,
  name: "Expenses",
  columns: [
    { name: "status", type: "text" as const, formula: null },
    { name: "amount", type: "number" as const, formula: null },
  ],
  created_at: "",
  updated_at: "",
};

beforeEach(() => {
  vi.mocked(listTemplates).mockResolvedValue([TEMPLATE]);
  vi.mocked(getTemplate).mockResolvedValue(TEMPLATE);
  vi.mocked(getSummary).mockResolvedValue([]);
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SummaryViewPage", () => {
  it("disables the export-with-summary action until a group-by column is chosen", async () => {
    render(<SummaryViewPage templateId={1} />);
    expect(await screen.findByRole("button", { name: /export with summary/i })).toBeDisabled();
  });

  it("enables the export action once a group-by column is selected", async () => {
    render(<SummaryViewPage templateId={1} />);
    await userEvent.selectOptions(await screen.findByLabelText(/group by/i), "status");
    expect(screen.getByRole("button", { name: /export with summary/i })).toBeEnabled();
  });

  it("fetches and renders the summary table once a group-by column is chosen", async () => {
    vi.mocked(getSummary).mockResolvedValue([
      { group_value: "open", count: 2, sum: null },
      { group_value: "closed", count: 1, sum: null },
    ]);
    render(<SummaryViewPage templateId={1} />);
    await userEvent.selectOptions(await screen.findByLabelText(/group by/i), "status");

    expect(getSummary).toHaveBeenCalledWith(1, "status", undefined);
    expect((await screen.findAllByText("open")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("closed").length).toBeGreaterThan(0);
    // Count column present, no "Total" column without a metric chosen.
    expect(screen.getByText("Count")).toBeInTheDocument();
    expect(screen.queryByText(/Total/)).not.toBeInTheDocument();
  });

  it("includes a metric sum column and chart once a metric is also chosen", async () => {
    vi.mocked(getSummary).mockResolvedValue([
      { group_value: "open", count: 2, sum: 15 },
      { group_value: "closed", count: 1, sum: 20 },
    ]);
    render(<SummaryViewPage templateId={1} />);
    await userEvent.selectOptions(await screen.findByLabelText(/group by/i), "status");
    await userEvent.selectOptions(await screen.findByLabelText(/metric/i), "amount");

    expect(getSummary).toHaveBeenCalledWith(1, "status", "amount");
    expect(await screen.findByText("Total amount")).toBeInTheDocument();
    expect(screen.getByText("Total amount by status")).toBeInTheDocument();
    // Scoped to the table (not the chart's own value labels, which render
    // the same numbers) to actually prove the table renders the fetched
    // sum values.
    const table = screen.getByRole("table");
    expect(within(table).getByText("15")).toBeInTheDocument();
    expect(within(table).getByText("20")).toBeInTheDocument();
  });

  it("calls exportTemplate with includeSummary, groupBy and metric when export is clicked", async () => {
    vi.mocked(getSummary).mockResolvedValue([{ group_value: "open", count: 2, sum: 15 }]);
    vi.mocked(exportTemplate).mockResolvedValue(new Blob(["x"]));
    render(<SummaryViewPage templateId={1} />);
    await userEvent.selectOptions(await screen.findByLabelText(/group by/i), "status");
    await userEvent.selectOptions(await screen.findByLabelText(/metric/i), "amount");

    await userEvent.click(screen.getByRole("button", { name: /export with summary/i }));

    expect(exportTemplate).toHaveBeenCalledWith(1, {
      includeSummary: true,
      groupBy: "status",
      metric: "amount",
    });
  });

  it("shows a plain-language prompt instead of a table before a group-by column is chosen", async () => {
    render(<SummaryViewPage templateId={1} />);
    expect(await screen.findByText(/pick a column to group by/i)).toBeInTheDocument();
  });

  // Brief's Review Focus scenario, with a `columns` prop so the pickers
  // render synchronously instead of waiting on a getTemplate fetch (see
  // the `columns` prop's doc comment on SummaryViewPageProps).
  describe("with columns supplied directly", () => {
    const COLUMNS = [{ name: "status", type: "text" as const, formula: null }];

    it("disables the export action until a group-by column is chosen", () => {
      render(<SummaryViewPage templateId={1} columns={COLUMNS} />);
      expect(screen.getByRole("button", { name: /export with summary/i })).toBeDisabled();
    });

    it("enables the export action once a group-by column is selected", async () => {
      render(<SummaryViewPage templateId={1} columns={COLUMNS} />);
      await userEvent.selectOptions(screen.getByLabelText(/group by/i), "status");
      expect(screen.getByRole("button", { name: /export with summary/i })).toBeEnabled();
    });
  });

  it("keeps the previous summary visible (dimmed, not blanked) while a metric change refetches", async () => {
    vi.mocked(getSummary).mockResolvedValueOnce([{ group_value: "open", count: 2, sum: null }]);
    let resolveSecond: (rows: SummaryRow[]) => void = () => {};
    vi.mocked(getSummary).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve;
        })
    );
    render(<SummaryViewPage templateId={1} />);
    await userEvent.selectOptions(await screen.findByLabelText(/group by/i), "status");
    expect(await screen.findByRole("table")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/metric/i), "amount");
    // The old, still-correctly-labeled table stays on screen — no
    // "Loading summary…" flash — while the metric refetch is pending.
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByText(/loading summary/i)).not.toBeInTheDocument();

    resolveSecond([{ group_value: "open", count: 2, sum: 15 }]);
    expect(await screen.findByText("Total amount")).toBeInTheDocument();
  });

  it("never renders a fractional axis tick for an all-integer (count) chart", async () => {
    // max=1 and max=3 both hit a non-integer midpoint (0.5 / 2.5) under
    // the chart's default 3-tick scheme — the fix drops the middle tick
    // rather than show a half-integer gridline on a whole-number axis.
    vi.mocked(getSummary).mockResolvedValue([
      { group_value: "open", count: 1, sum: null },
      { group_value: "closed", count: 1, sum: null },
    ]);
    const { container } = render(<SummaryViewPage templateId={1} />);
    await userEvent.selectOptions(await screen.findByLabelText(/group by/i), "status");
    await screen.findByRole("table");

    const ticks = Array.from(container.querySelectorAll(".sv-axis-tick")).map((el) => el.textContent);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.every((t) => !t?.includes("."))).toBe(true);
  });
});
