import type {
  RecordRead,
  TemplateApplyResult,
  TemplateColumn,
  TemplateRead,
  TemplateWarningResult,
} from "./types";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`API error: ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** Reads the response body as text, then as JSON if it parses; returns undefined for an empty body. */
async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, init);
  if (!res.ok) {
    throw new ApiError(res.status, await parseBody(res));
  }
  return (await parseBody(res)) as T;
}

function jsonBody(body: unknown): RequestInit {
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function listTemplates(): Promise<TemplateRead[]> {
  return request<TemplateRead[]>("/templates");
}

export function getTemplate(id: number): Promise<TemplateRead> {
  return request<TemplateRead>(`/templates/${id}`);
}

export function createTemplate(input: {
  name: string;
  columns: TemplateColumn[];
}): Promise<TemplateRead> {
  return request<TemplateRead>("/templates", {
    method: "POST",
    ...jsonBody(input),
  });
}

export function updateTemplate(
  id: number,
  input: { name: string; columns: TemplateColumn[]; force?: boolean }
): Promise<TemplateApplyResult | TemplateWarningResult> {
  return request<TemplateApplyResult | TemplateWarningResult>(`/templates/${id}`, {
    method: "PUT",
    ...jsonBody(input),
  });
}

export function deleteTemplate(id: number): Promise<void> {
  return request<void>(`/templates/${id}`, { method: "DELETE" });
}

export function listRecords(templateId: number, search?: string): Promise<RecordRead[]> {
  const params = new URLSearchParams();
  if (search) {
    params.set("search", search);
  }
  const query = params.toString();
  return request<RecordRead[]>(`/templates/${templateId}/records${query ? `?${query}` : ""}`);
}

export function createRecord(
  templateId: number,
  data: Record<string, unknown>
): Promise<RecordRead> {
  return request<RecordRead>(`/templates/${templateId}/records`, {
    method: "POST",
    ...jsonBody({ data }),
  });
}

export function updateRecord(id: number, data: Record<string, unknown>): Promise<RecordRead> {
  return request<RecordRead>(`/records/${id}`, {
    method: "PUT",
    ...jsonBody({ data }),
  });
}

export function deleteRecord(id: number): Promise<void> {
  return request<void>(`/records/${id}`, { method: "DELETE" });
}
