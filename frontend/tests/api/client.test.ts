import { describe, it, expect, vi, beforeEach } from "vitest";
import { listTemplates, createTemplate, exportTemplate, importTemplate, ApiError } from "../../src/api/client";

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

describe("exportTemplate", () => {
  it("fetches the export endpoint with the given options as query params and returns a Blob", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("/templates/1/export?include_summary=true&group_by=category&metric=amount");
      return new Response("xlsx-bytes", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const blob = await exportTemplate(1, { includeSummary: true, groupBy: "category", metric: "amount" });

    // Not asserting `instanceof Blob`: jsdom's fetch/Response implementation
    // returns a Blob from a different realm than the test file's global
    // Blob, so `instanceof` doesn't hold even though it behaves like one.
    expect(await blob.text()).toBe("xlsx-bytes");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetches with no query string when no options are given", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("/templates/1/export");
      return new Response("xlsx-bytes", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await exportTemplate(1);
  });

  it("throws a typed ApiError on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: "group_by is required" }), { status: 422 }))
    );
    await expect(exportTemplate(1, { includeSummary: true })).rejects.toBeInstanceOf(ApiError);
  });
});

describe("importTemplate", () => {
  it("POSTs a multipart form with the file under the 'file' field and no manual Content-Type header", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("/templates/1/import");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeInstanceOf(FormData);
      expect((init?.body as FormData).get("file")).toBeInstanceOf(File);
      // Deliberately not setting Content-Type: the browser must set its
      // own multipart boundary for FormData, which a manual header would
      // break.
      expect(init?.headers).toBeUndefined();
      return new Response(JSON.stringify({ imported_count: 1, errors: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["a,b"], "data.xlsx");
    const result = await importTemplate(1, file);

    expect(result).toEqual({ imported_count: 1, errors: [] });
  });

  it("throws a typed ApiError with status 422 on an import error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: "Could not read uploaded file as an .xlsx workbook" }), {
            status: 422,
          })
      )
    );
    const file = new File(["bad"], "data.xlsx");
    await expect(importTemplate(1, file)).rejects.toBeInstanceOf(ApiError);
  });
});
