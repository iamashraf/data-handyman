import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SummaryViewPage } from "../../src/pages/SummaryViewPage";
import {
  listTemplates,
  getTemplate,
  getSummary,
  exportTemplate,
  listSummaryViews,
  createSummaryView,
  deleteSummaryView,
} from "../../src/api/client";
import type { SummaryRow } from "../../src/api/types";

vi.mock("../../src/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client")>();
  return {
    ...actual,
    listTemplates: vi.fn(),
    getTemplate: vi.fn(),
    getSummary: vi.fn(),
    exportTemplate: vi.fn(),
    listSummaryViews: vi.fn(),
    createSummaryView: vi.fn(),
    deleteSummaryView: vi.fn(),
  };
});

const TEMPLATE = {
  id: 1,
  name: "Expenses",
  columns: [
    { name: "status", type: "text" as const, formula: null },
    { name: "amount", type: "number" as const, formula: null },
  ],
  unique_constraints: [],
  created_at: "",
  updated_at: "",
};

beforeEach(() => {
  vi.mocked(listTemplates).mockResolvedValue([TEMPLATE]);
  vi.mocked(getTemplate).mockResolvedValue(TEMPLATE);
  vi.mocked(getSummary).mockResolvedValue([]);
  vi.mocked(listSummaryViews).mockResolvedValue([]);
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Group by is a checkbox dropdown (not a native multi-select): open it,
 *  check the given columns by name, leave it open (closing isn't needed
 *  for assertions). */
async function selectGroupBy(names: string[]) {
  await userEvent.click(await screen.findByRole("button", { name: /group by/i }));
  for (const name of names) {
    await userEvent.click(screen.getByRole("checkbox", { name }));
  }
}

describe("SummaryViewPage", () => {
  it("disables the export-with-summary action until a group-by column is chosen", async () => {
    render(<SummaryViewPage templateId={1} />);
    expect(await screen.findByRole("button", { name: /export with summary/i })).toBeDisabled();
  });

  it("enables the export action once a group-by column is selected", async () => {
    render(<SummaryViewPage templateId={1} />);
    await selectGroupBy(["status"]);
    expect(screen.getByRole("button", { name: /export with summary/i })).toBeEnabled();
  });

  it("fetches and renders the summary table once a group-by column is chosen", async () => {
    vi.mocked(getSummary).mockResolvedValue([
      { group_values: { status: "open" }, count: 2, sum: null },
      { group_values: { status: "closed" }, count: 1, sum: null },
    ]);
    render(<SummaryViewPage templateId={1} />);
    await selectGroupBy(["status"]);

    expect(getSummary).toHaveBeenCalledWith(1, ["status"], undefined);
    expect((await screen.findAllByText("open")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("closed").length).toBeGreaterThan(0);
    // Count column present, no "Total" column without a metric chosen.
    expect(screen.getByText("Count")).toBeInTheDocument();
    expect(screen.queryByText(/Total/)).not.toBeInTheDocument();
  });

  it("groups by multiple columns, with one table column per dimension", async () => {
    vi.mocked(getSummary).mockResolvedValue([
      { group_values: { status: "open", amount: 2 }, count: 1, sum: null },
      { group_values: { status: "closed", amount: 5 }, count: 1, sum: null },
    ]);
    render(<SummaryViewPage templateId={1} />);
    await selectGroupBy(["status", "amount"]);

    expect(getSummary).toHaveBeenCalledWith(1, ["status", "amount"], undefined);
    const table = await screen.findByRole("table");
    // One <th> per group-by column (named after the raw column), plus Count.
    expect(within(table).getByRole("columnheader", { name: "status" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "amount" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Count" })).toBeInTheDocument();
  });

  it("includes a metric sum column and chart once a metric is also chosen", async () => {
    vi.mocked(getSummary).mockResolvedValue([
      { group_values: { status: "open" }, count: 2, sum: 15 },
      { group_values: { status: "closed" }, count: 1, sum: 20 },
    ]);
    render(<SummaryViewPage templateId={1} />);
    await selectGroupBy(["status"]);
    await userEvent.selectOptions(await screen.findByLabelText(/metric/i), "amount");

    expect(getSummary).toHaveBeenCalledWith(1, ["status"], "amount");
    expect(await screen.findByText("Total amount")).toBeInTheDocument();
    expect(screen.getByText("Total amount by status")).toBeInTheDocument();
    // Scoped to the table (not the chart's own value labels, which render
    // the same numbers) to actually prove the table renders the fetched
    // sum values.
    const table = screen.getByRole("table");
    expect(within(table).getByText("15")).toBeInTheDocument();
    expect(within(table).getByText("20")).toBeInTheDocument();
  });

  it("lets the user pick a chart type", async () => {
    render(<SummaryViewPage templateId={1} />);
    const chartTypeSelect = await screen.findByLabelText(/chart type/i);
    await userEvent.selectOptions(chartTypeSelect, "line");
    expect((chartTypeSelect as HTMLSelectElement).value).toBe("line");
  });

  it("calls exportTemplate with includeSummary, groupBy and metric when export is clicked", async () => {
    vi.mocked(getSummary).mockResolvedValue([{ group_values: { status: "open" }, count: 2, sum: 15 }]);
    vi.mocked(exportTemplate).mockResolvedValue(new Blob(["x"]));
    render(<SummaryViewPage templateId={1} />);
    await selectGroupBy(["status"]);
    await userEvent.selectOptions(await screen.findByLabelText(/metric/i), "amount");

    await userEvent.click(screen.getByRole("button", { name: /export with summary/i }));

    expect(exportTemplate).toHaveBeenCalledWith(1, {
      includeSummary: true,
      groupBy: ["status"],
      metric: "amount",
      chartType: "bar",
    });
  });

  it("shows a plain-language prompt instead of a table before a group-by column is chosen", async () => {
    render(<SummaryViewPage templateId={1} />);
    expect(await screen.findByText(/pick one or more columns to group by/i)).toBeInTheDocument();
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
      await selectGroupBy(["status"]);
      expect(screen.getByRole("button", { name: /export with summary/i })).toBeEnabled();
    });
  });

  it("keeps the previous summary visible (dimmed, not blanked) while a metric change refetches", async () => {
    vi.mocked(getSummary).mockResolvedValueOnce([{ group_values: { status: "open" }, count: 2, sum: null }]);
    let resolveSecond: (rows: SummaryRow[]) => void = () => {};
    vi.mocked(getSummary).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve;
        })
    );
    render(<SummaryViewPage templateId={1} />);
    await selectGroupBy(["status"]);
    expect(await screen.findByRole("table")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/metric/i), "amount");
    // The old, still-correctly-labeled table stays on screen — no
    // "Loading summary…" flash — while the metric refetch is pending.
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByText(/loading summary/i)).not.toBeInTheDocument();

    resolveSecond([{ group_values: { status: "open" }, count: 2, sum: 15 }]);
    expect(await screen.findByText("Total amount")).toBeInTheDocument();
  });

  // Recharts now owns tick rendering (the old hand-rolled SVG's
  // `.sv-axis-tick` DOM is gone), so this is a coarser smoke check that
  // the chart renders without throwing for an all-integer dataset, rather
  // than re-testing the removed mechanism directly.
  it("renders the chart without throwing for an all-integer (count) dataset", async () => {
    vi.mocked(getSummary).mockResolvedValue([
      { group_values: { status: "open" }, count: 1, sum: null },
      { group_values: { status: "closed" }, count: 1, sum: null },
    ]);
    render(<SummaryViewPage templateId={1} />);
    await selectGroupBy(["status"]);
    await screen.findByRole("table");
    expect(screen.getByText("Count by status")).toBeInTheDocument();
  });

  describe("saved views", () => {
    const SAVED_VIEW = {
      id: 10,
      template_id: 1,
      name: "By status",
      group_by: ["status"],
      metric: "amount",
      chart_type: "bar" as const,
      created_at: "",
      updated_at: "",
    };

    it("creates a view via Save as view, posting the current pickers (including chart type) and showing the new card", async () => {
      vi.mocked(createSummaryView).mockResolvedValue(SAVED_VIEW);
      render(<SummaryViewPage templateId={1} />);
      await selectGroupBy(["status"]);
      await userEvent.selectOptions(await screen.findByLabelText(/metric/i), "amount");
      await userEvent.selectOptions(await screen.findByLabelText(/chart type/i), "line");

      await userEvent.click(screen.getByRole("button", { name: /save as view/i }));
      await userEvent.type(screen.getByPlaceholderText(/view name/i), "By status");
      await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

      await waitFor(() =>
        expect(createSummaryView).toHaveBeenCalledWith(1, {
          name: "By status",
          groupBy: ["status"],
          metric: "amount",
          chartType: "line",
        })
      );
      expect(await screen.findByRole("button", { name: "By status" })).toBeInTheDocument();
    });

    it("loads a saved view's pickers (group by, metric, and chart type) when its card title is clicked, refetching the summary", async () => {
      const pieView = { ...SAVED_VIEW, chart_type: "pie" as const };
      vi.mocked(listSummaryViews).mockResolvedValue([pieView]);
      render(<SummaryViewPage templateId={1} />);

      const cardTitle = await screen.findByRole("button", { name: "By status" });
      vi.mocked(getSummary).mockClear();
      await userEvent.click(cardTitle);

      await waitFor(() => expect(getSummary).toHaveBeenCalledWith(1, ["status"], "amount"));
      expect(screen.getByRole("button", { name: /group by/i })).toHaveTextContent("status");
      // Proves the page's own picker state changed (not just that a
      // getSummary call happened, which the card's own mount-time fetch
      // would also produce).
      expect((screen.getByLabelText(/metric/i) as HTMLSelectElement).value).toBe("amount");
      expect((screen.getByLabelText(/chart type/i) as HTMLSelectElement).value).toBe("pie");
    });

    it("deletes a saved view via its card's delete button, removing the card", async () => {
      vi.mocked(listSummaryViews).mockResolvedValue([SAVED_VIEW]);
      vi.mocked(deleteSummaryView).mockResolvedValue(undefined);
      vi.spyOn(window, "confirm").mockReturnValue(true);
      render(<SummaryViewPage templateId={1} />);

      await screen.findByRole("button", { name: "By status" });
      await userEvent.click(screen.getByRole("button", { name: /delete view by status/i }));

      await waitFor(() => expect(deleteSummaryView).toHaveBeenCalledWith(10));
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "By status" })).not.toBeInTheDocument()
      );
    });
  });
});
