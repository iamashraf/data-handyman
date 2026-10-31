import { describe, it, expect, vi, beforeEach } from "vitest";
import { listTemplates, createTemplate, ApiError } from "../../src/api/client";

describe("listTemplates", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify([{ id: 1, name: "T", columns: [], created_at: "", updated_at: "" }]), { status: 200 })
    ));
  });

  it("fetches and returns templates", async () => {
    const templates = await listTemplates();
    expect(templates).toHaveLength(1);
    expect(templates[0].name).toBe("T");
  });
});

describe("createTemplate", () => {
  it("throws a typed ApiError with status 422 on an invalid-formula response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ detail: "invalid formula" }), { status: 422 })
    ));

    await expect(
      createTemplate({ name: "T", columns: [] })
    ).rejects.toMatchObject({ status: 422 });

    await expect(
      createTemplate({ name: "T", columns: [] })
    ).rejects.toBeInstanceOf(ApiError);
  });
});
