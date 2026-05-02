export type DocumentListItem = {
  document_id: string;
  page_count: number;
  source_pdf: string;
  source_pdf_name: string;
  has_edited_pdf: boolean;
  updated_at: string;
};

export type SessionState = {
  session_id: string;
  document_id: string;
  translation_engine: string;
  source_language_code?: string;
  target_language_code?: string;
  mirror_enabled?: boolean;
  opening_notice?: string;
  has_unsaved_local_edits?: boolean;
  page_ids: number[];
  page_count: number;
  source_pdf_name: string;
  canvas_pdf_url: string;
  initial_pdf_url: string;
  edited_pdf_url: string;
  validation_report: unknown;
  vlm_critic: {
    status: string;
    error: string;
    generated_at: string;
    suggestion_count: number;
  };
};

export type UploadJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type UploadJobState = {
  job_id: string;
  status: UploadJobStatus;
  current_phase: string;
  progress_percent: number;
  elapsed_ms: number;
  phase_started_at: string;
  pages_total: number;
  pages_done: number;
  session_id: string;
  document_id: string;
  error: string;
  created_at: string;
  started_at: string;
  finished_at: string;
  performance_summary_url: string;
};

export type CriticSuggestion = {
  suggestion_id: string;
  page_id: number;
  block_id: string;
  op: string;
  reason: string;
  actionable: boolean;
  rejected_reason: string;
  before: unknown;
  after: unknown;
};

export type CriticSuggestionsResponse = {
  session_id: string;
  document_id: string;
  status: string;
  error: string;
  generated_at: string;
  suggestions: CriticSuggestion[];
};

export type ApiError = {
  error?: string;
};

export type PageBlock = {
  source_block_id: string;
  text: string;
  bbox: number[];
  source_bbox?: number[];
  pre_fit_bbox?: number[];
  font_size: number;
  source_font_size?: number;
  alignment: string;
  alignment_edited?: boolean;
  font_family: string;
  font_weight: string;
  source_font_weight?: string;
  wrap_mode: string;
  clip_mode: string;
  overflow: boolean;
  collision: boolean;
  redacted: boolean;
  block_type: string;
  render_mode?: number;
  stroke_width?: number;
  effective_font_weight?: 'normal' | 'bold';
  faux_bold_policy?: 'semantic' | 'stroke';
  draw_plan?: unknown;
  line_height?: number;
  text_color?: string;
  source_text?: string;
  source_clip_default?: boolean;
  bbox_edited?: boolean;
  source_line_count?: number;
  source_line_bbox?: number[];
  source_bottom_inset_ratio?: number;
  source_text_orientation?: string;
  text_rotation_deg?: number;
  preserve_vertical_source_anchor?: boolean;
  style_id?: string;
  truncated?: boolean;
  issue?: Record<string, unknown>;
  fit_strategy?: string;
  bucket_ratio?: number;
  nominal_font_size?: number;
  text_tightness?: string;
  mixed_bidi_reconstructed?: boolean;
  background_fill_enabled?: boolean;
  background_fill_color?: number[];
};

export type ExtractionWarning = {
  suspicious: boolean;
  reasons: string[];
  score?: number;
};

export type PagePayload = {
  session_id: string;
  document_id: string;
  page_id: number;
  page_size_pt: number[];
  preview_url: string;
  extraction_warning?: ExtractionWarning | null;
  blocks: PageBlock[];
  tables: unknown[];
  graphic_regions: GraphicRegionPayload[];
  logo_regions?: LogoRegionPayload[];
  background_visual_regions?: BackgroundVisualRegionPayload[];
};

export type GraphicRegionPayload = {
  region_id: string;
  flipped?: boolean;
  moved_bbox?: number[];
  bbox?: number[];
  source_kind?: 'graphic_region' | 'raster_logo_candidate';
  auto_protected?: boolean;
  score?: number;
};

export type LogoRegionPayload = {
  logo_id: string;
  bbox: number[];
  source_kind?: 'image' | 'graphic_region';
  source_id?: string;
};

export type BackgroundVisualRegionPayload = {
  visual_id: string;
  bbox: number[];
  kind: 'image' | 'graphic_region';
  logo_candidate?: boolean;
};

export type SnapshotBlockInput = {
  source_block_id: string;
  text: string;
  bbox: number[];
  font_size: number;
  line_height?: number;
  alignment: string;
  alignment_edited?: boolean;
  font_family: string;
  font_weight: string;
  wrap_mode: string;
  clip_mode: string;
};

export type SnapshotGraphicRegionInput = {
  region_id: string;
  flipped?: boolean;
  bbox?: number[];
  source_bbox?: number[];
};

export type SnapshotPageInput = {
  page_id: number;
  blocks: SnapshotBlockInput[];
  graphic_regions: SnapshotGraphicRegionInput[];
};

export type SnapshotRequest = {
  document_id: string;
  version: number;
  pages: SnapshotPageInput[];
};

export type RenderSnapshotResponse = {
  session_id: string;
  document_id: string;
  edited_pdf_url: string;
  validation_report: unknown;
  pages: PagePayload[];
};
