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
  unique_constraints: [],
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
        template: { id: 1, name: "T", columns: [], unique_constraints: [], created_at: "", updated_at: "" },
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
      unique_constraints: [],
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
      columns: [{ name: "amount", type: "text", formula: null, format: null }],
      unique_constraints: [],
    });
  });

  it("marks a text column as long text, saving it with format: long_text", async () => {
    const created = {
      id: 2,
      name: "Tickets",
      columns: [{ name: "notes", type: "text" as const, formula: null }],
      unique_constraints: [],
      created_at: "",
      updated_at: "",
    };
    vi.mocked(createTemplate).mockResolvedValueOnce(created);
    render(<TemplateBuilderPage />);
    await userEvent.type(screen.getByLabelText(/template name/i), "Tickets");
    await userEvent.click(screen.getByRole("button", { name: /add column/i }));
    await userEvent.type(screen.getByLabelText(/column 1 name/i), "notes");
    await userEvent.click(screen.getByLabelText(/column 1 long text/i));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(createTemplate).toHaveBeenCalledWith({
      name: "Tickets",
      columns: [{ name: "notes", type: "text", formula: null, format: "long_text" }],
      unique_constraints: [],
    });
  });

  it("disables and ignores the long-text checkbox for a non-text column", async () => {
    const created = {
      id: 2,
      name: "T",
      columns: [{ name: "count", type: "number" as const, formula: null }],
      unique_constraints: [],
      created_at: "",
      updated_at: "",
    };
    vi.mocked(createTemplate).mockResolvedValueOnce(created);
    render(<TemplateBuilderPage />);
    await userEvent.type(screen.getByLabelText(/template name/i), "T");
    await userEvent.click(screen.getByRole("button", { name: /add column/i }));
    await userEvent.type(screen.getByLabelText(/column 1 name/i), "count");
    await userEvent.selectOptions(screen.getByLabelText(/column 1 type/i), "number");
    expect(screen.getByLabelText(/column 1 long text/i)).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(createTemplate).toHaveBeenCalledWith({
      name: "T",
      columns: [{ name: "count", type: "number", formula: null, format: null }],
      unique_constraints: [],
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

  describe("unique constraints", () => {
    it("adds a constraint over two columns and includes it in the save payload", async () => {
      const created = {
        id: 2,
        name: "Inventory",
        columns: [
          { name: "amount", type: "number" as const, formula: null },
          { name: "region", type: "text" as const, formula: null },
        ],
        unique_constraints: [{ name: "No dup amount+region", columns: ["amount", "region"] }],
        created_at: "",
        updated_at: "",
      };
      vi.mocked(createTemplate).mockResolvedValueOnce(created);
      render(<TemplateBuilderPage />);
      await userEvent.type(screen.getByLabelText(/template name/i), "Inventory");

      await userEvent.click(screen.getByRole("button", { name: /add column/i }));
      await userEvent.type(screen.getByLabelText(/column 1 name/i), "amount");
      await userEvent.selectOptions(screen.getByLabelText(/column 1 type/i), "number");
      await userEvent.click(screen.getByRole("button", { name: /add column/i }));
      await userEvent.type(screen.getByLabelText(/column 2 name/i), "region");

      // "+ Add unique constraint" auto-opens the new row's picker.
      await userEvent.click(screen.getByRole("button", { name: /add unique constraint/i }));
      await userEvent.click(screen.getByRole("checkbox", { name: "amount" }));
      await userEvent.click(screen.getByRole("checkbox", { name: "region" }));
      await userEvent.type(screen.getByLabelText(/unique constraint 1 name/i), "No dup amount+region");

      await userEvent.click(screen.getByRole("button", { name: /save/i }));

      expect(createTemplate).toHaveBeenCalledWith({
        name: "Inventory",
        columns: [
          { name: "amount", type: "number", formula: null, format: null },
          { name: "region", type: "text", formula: null, format: null },
        ],
        unique_constraints: [{ name: "No dup amount+region", columns: ["amount", "region"] }],
      });
    });

    it("omits an unfinished constraint (no columns picked) from the save payload", async () => {
      const created = {
        id: 2,
        name: "T",
        columns: [{ name: "amount", type: "text" as const, formula: null }],
        unique_constraints: [],
        created_at: "",
        updated_at: "",
      };
      vi.mocked(createTemplate).mockResolvedValueOnce(created);
      render(<TemplateBuilderPage />);
      await userEvent.type(screen.getByLabelText(/template name/i), "T");
      await userEvent.click(screen.getByRole("button", { name: /add column/i }));
      await userEvent.type(screen.getByLabelText(/column 1 name/i), "amount");
      await userEvent.click(screen.getByRole("button", { name: /add unique constraint/i }));
      // No column checked -- the row stays unfinished.
      await userEvent.click(screen.getByRole("button", { name: /save/i }));

      expect(createTemplate).toHaveBeenCalledWith({
        name: "T",
        columns: [{ name: "amount", type: "text", formula: null, format: null }],
        unique_constraints: [],
      });
    });

    it("defaults an unnamed constraint's name to its joined column names", async () => {
      const created = {
        id: 2,
        name: "T",
        columns: [
          { name: "amount", type: "text" as const, formula: null },
          { name: "region", type: "text" as const, formula: null },
        ],
        unique_constraints: [{ name: "amount + region", columns: ["amount", "region"] }],
        created_at: "",
        updated_at: "",
      };
      vi.mocked(createTemplate).mockResolvedValueOnce(created);
      render(<TemplateBuilderPage />);
      await userEvent.type(screen.getByLabelText(/template name/i), "T");
      await userEvent.click(screen.getByRole("button", { name: /add column/i }));
      await userEvent.type(screen.getByLabelText(/column 1 name/i), "amount");
      await userEvent.click(screen.getByRole("button", { name: /add column/i }));
      await userEvent.type(screen.getByLabelText(/column 2 name/i), "region");
      await userEvent.click(screen.getByRole("button", { name: /add unique constraint/i }));
      await userEvent.click(screen.getByRole("checkbox", { name: "amount" }));
      await userEvent.click(screen.getByRole("checkbox", { name: "region" }));
      // Constraint name left blank -- falls back to the joined column names.
      await userEvent.click(screen.getByRole("button", { name: /save/i }));

      expect(createTemplate).toHaveBeenCalledWith({
        name: "T",
        columns: [
          { name: "amount", type: "text", formula: null, format: null },
          { name: "region", type: "text", formula: null, format: null },
        ],
        unique_constraints: [{ name: "amount + region", columns: ["amount", "region"] }],
      });
    });

    it("removing a constraint row removes it from the save payload", async () => {
      const created = {
        id: 2,
        name: "T",
        columns: [
          { name: "amount", type: "text" as const, formula: null },
          { name: "region", type: "text" as const, formula: null },
        ],
        unique_constraints: [{ name: "region", columns: ["region"] }],
        created_at: "",
        updated_at: "",
      };
      vi.mocked(createTemplate).mockResolvedValueOnce(created);
      render(<TemplateBuilderPage />);
      await userEvent.type(screen.getByLabelText(/template name/i), "T");
      await userEvent.click(screen.getByRole("button", { name: /add column/i }));
      await userEvent.type(screen.getByLabelText(/column 1 name/i), "amount");
      await userEvent.click(screen.getByRole("button", { name: /add column/i }));
      await userEvent.type(screen.getByLabelText(/column 2 name/i), "region");

      await userEvent.click(screen.getByRole("button", { name: /add unique constraint/i }));
      await userEvent.click(screen.getByRole("checkbox", { name: "amount" }));

      await userEvent.click(screen.getByRole("button", { name: /add unique constraint/i }));
      await userEvent.click(screen.getByRole("checkbox", { name: "region" }));

      // Removes the first constraint row (the "amount" one); the second
      // ("region") row's content must survive, independent of its own
      // index renumbering after the removal.
      await userEvent.click(screen.getByRole("button", { name: /remove unique constraint 1/i }));

      await userEvent.click(screen.getByRole("button", { name: /save/i }));

      expect(createTemplate).toHaveBeenCalledWith({
        name: "T",
        columns: [
          { name: "amount", type: "text", formula: null, format: null },
          { name: "region", type: "text", formula: null, format: null },
        ],
        unique_constraints: [{ name: "region", columns: ["region"] }],
      });
    });

    it("loads an existing template's saved unique constraint and resends it on an unrelated save", async () => {
      const templateWithConstraint = {
        id: 5,
        name: "Serials",
        columns: [{ name: "serial_no", type: "text" as const, formula: null }],
        unique_constraints: [{ name: "Serial No", columns: ["serial_no"] }],
        created_at: "",
        updated_at: "",
      };
      vi.mocked(listTemplates).mockResolvedValue([templateWithConstraint]);
      vi.mocked(getTemplate).mockResolvedValue(templateWithConstraint);
      vi.mocked(updateTemplate).mockResolvedValueOnce({
        status: "applied",
        template: templateWithConstraint,
      });

      render(<TemplateBuilderPage templateId={5} />);

      const pickerButton = await screen.findByRole("button", { name: /unique constraint 1 columns/i });
      expect(pickerButton).toHaveTextContent("serial_no");

      await userEvent.click(screen.getByRole("button", { name: /save/i }));

      expect(updateTemplate).toHaveBeenCalledWith(5, {
        name: "Serials",
        columns: [{ name: "serial_no", type: "text", formula: null, format: null }],
        unique_constraints: [{ name: "Serial No", columns: ["serial_no"] }],
      });
    });

    it("reuses the warning dialog and resubmits with force when the warning reason is about a unique constraint", async () => {
      vi.mocked(updateTemplate)
        .mockResolvedValueOnce({
          status: "warning",
          affected_record_count: 2,
          reasons: [
            "Unique constraint 'Status check' (status) conflicts with 2 existing record(s) that share the same value",
          ],
        })
        .mockResolvedValueOnce({
          status: "applied",
          template: {
            id: 1,
            name: "T",
            columns: [{ name: "status", type: "text" as const, formula: null }],
            unique_constraints: [{ name: "status", columns: ["status"] }],
            created_at: "",
            updated_at: "",
          },
        });
      render(<TemplateBuilderPage templateId={1} />);
      // Wait for the loaded template's own column ("status") before adding
      // a constraint over it.
      await screen.findByDisplayValue("T");

      await userEvent.click(screen.getByRole("button", { name: /add unique constraint/i }));
      await userEvent.click(screen.getByRole("checkbox", { name: "status" }));

      await userEvent.click(screen.getByRole("button", { name: /save/i }));
      expect(await screen.findByText(/Unique constraint 'Status check'/)).toBeInTheDocument();

      await userEvent.click(await screen.findByRole("button", { name: /confirm/i }));

      expect(updateTemplate).toHaveBeenLastCalledWith(
        1,
        expect.objectContaining({
          force: true,
          unique_constraints: [{ name: "status", columns: ["status"] }],
        })
      );
    });
  });
});
