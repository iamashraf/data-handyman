import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TemplateBuilderPage } from "../../src/pages/TemplateBuilderPage";
import { listTemplates, getTemplate, createTemplate, updateTemplate, ApiError } from "../../src/api/client";

vi.mock("../../src/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client")>();
  return {
    ...actual,
    listTemplates: vi.fn(),
    getTemplate: vi.fn(),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
  };
});

const EXISTING_TEMPLATE = {
  id: 1,
  name: "T",
  columns: [{ name: "status", type: "text" as const, formula: null }],
  created_at: "",
  updated_at: "",
};

beforeEach(() => {
  vi.mocked(listTemplates).mockResolvedValue([EXISTING_TEMPLATE]);
  vi.mocked(getTemplate).mockResolvedValue(EXISTING_TEMPLATE);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TemplateBuilderPage", () => {
  it("shows a confirmation dialog when a save is blocked by a destructive-change warning", async () => {
    vi.mocked(updateTemplate).mockResolvedValueOnce({
      status: "warning",
      affected_record_count: 3,
      reasons: ["removing column 'status' loses 3 records' data"],
    });
    render(<TemplateBuilderPage templateId={1} />);
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(/3 records/)).toBeInTheDocument();
    expect(screen.getByText(/removing column 'status'/)).toBeInTheDocument();
  });

  it("resubmits with force:true when the user confirms the warning", async () => {
    vi.mocked(updateTemplate)
      .mockResolvedValueOnce({ status: "warning", affected_record_count: 3, reasons: ["..."] })
      .mockResolvedValueOnce({
        status: "applied",
        template: { id: 1, name: "T", columns: [], created_at: "", updated_at: "" },
      });
    render(<TemplateBuilderPage templateId={1} />);
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await userEvent.click(await screen.findByRole("button", { name: /confirm/i }));
    expect(updateTemplate).toHaveBeenLastCalledWith(1, expect.objectContaining({ force: true }));
  });

  it("does not call the API when the user cancels the warning", async () => {
    vi.mocked(updateTemplate).mockResolvedValueOnce({
      status: "warning",
      affected_record_count: 1,
      reasons: ["removing column 'notes' loses data"],
    });
    render(<TemplateBuilderPage templateId={1} />);
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await userEvent.click(await screen.findByRole("button", { name: /cancel/i }));
    expect(updateTemplate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/existing record/)).not.toBeInTheDocument();
  });

  it("states the affected-record count in plain language, independent of the reason text, including the singular case", async () => {
    vi.mocked(updateTemplate).mockResolvedValueOnce({
      status: "warning",
      affected_record_count: 1,
      reasons: ["breaks the formula in column 'total'"],
    });
    render(<TemplateBuilderPage templateId={1} />);
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(/1 existing record\b/)).toBeInTheDocument();
  });

  it("shows the error and closes the dialog when the forced resubmit itself fails", async () => {
    vi.mocked(updateTemplate)
      .mockResolvedValueOnce({ status: "warning", affected_record_count: 3, reasons: ["..."] })
      .mockRejectedValueOnce(new ApiError(422, { detail: "Formula error: unknown function FOOBAR" }));
    render(<TemplateBuilderPage templateId={1} />);
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await userEvent.click(await screen.findByRole("button", { name: /confirm/i }));
    expect(await screen.findByText(/unknown function FOOBAR/)).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("creates a new template with the entered name and columns", async () => {
    const created = {
      id: 2,
      name: "Expenses",
      columns: [{ name: "amount", type: "text" as const, formula: null }],
      created_at: "",
      updated_at: "",
    };
    vi.mocked(createTemplate).mockResolvedValueOnce(created);
    render(<TemplateBuilderPage />);
    await userEvent.type(screen.getByLabelText(/template name/i), "Expenses");
    await userEvent.click(screen.getByRole("button", { name: /add column/i }));
    await userEvent.type(screen.getByLabelText(/column 1 name/i), "amount");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(createTemplate).toHaveBeenCalledWith({
      name: "Expenses",
      columns: [{ name: "amount", type: "text", formula: null }],
    });
  });

  it("shows a plain-language error when the backend rejects the save (e.g. an invalid formula)", async () => {
    vi.mocked(createTemplate).mockRejectedValueOnce(
      new ApiError(422, { detail: "Formula error: unknown function FOOBAR" })
    );
    render(<TemplateBuilderPage />);
    await userEvent.type(screen.getByLabelText(/template name/i), "Expenses");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(/unknown function FOOBAR/)).toBeInTheDocument();
  });

  it("lists existing templates so the user can pick one to edit", async () => {
    render(<TemplateBuilderPage />);
    await userEvent.click(await screen.findByRole("button", { name: /select a template/i }));
    expect(await screen.findByRole("option", { name: /^T/ })).toBeInTheDocument();
  });
});
