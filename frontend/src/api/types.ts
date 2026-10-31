export interface TemplateColumn {
  name: string;
  type: "text" | "number" | "date" | "boolean";
  formula: string | null;
}

export interface TemplateRead {
  id: number;
  name: string;
  columns: TemplateColumn[];
  created_at: string;
  updated_at: string;
}

export interface TemplateApplyResult {
  status: "applied";
  template: TemplateRead;
}

export interface TemplateWarningResult {
  status: "warning";
  affected_record_count: number;
  reasons: string[];
}

export interface RecordRead {
  id: number;
  template_id: number;
  data: Record<string, unknown>;
  computed: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ImportResult {
  imported_count: number;
  errors: { row_number: number; reason: string }[];
}
