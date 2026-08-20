export type AnalyticsData = {
  total_users: number
  total_generations: number
  generations_by_status: Record<string, number>
  total_guest_generations: number
  average_generation_latency_seconds: number
  p50_latency_seconds?: number
  p90_latency_seconds?: number
  p99_latency_seconds?: number
  duration_buckets?: {
    under_30s: number
    "30s_to_60s": number
    "1m_to_2m": number
    "2m_to_5m": number
    over_5m: number
  }
  failure_rate_percent: number
  keys_status: {
    openrouter?: { configured_keys_count: number; model?: string; base_url?: string }
    pro?: { configured_keys_count: number; model?: string; base_url?: string }
    google: { configured_keys_count: number; model?: string }
  }
  llm_metrics: MetricSummary
}

export type MetricSummary = {
  total_tokens: number
  average_node_latency_ms: number
  fallback_count: number
  parse_error_count: number
  recorded_calls: number
}

export type MetricNode = {
  node_name: string
  provider: string
  calls: number
  average_latency_ms: number
  errors: number
  fallbacks: number
  parse_errors: number
  total_tokens: number
}

export type PromptConfig = {
  name: string
  system_prompt: string
  user_prompt?: string
  updated_at?: string
}

export type GenerationItem = {
  id: string
  user_id: string
  email?: string
  template_id: string
  job_title?: string
  company?: string
  model_used: string
  status: string
  created_at: string
  completed_at?: string
  duration_seconds?: number | null
  is_guest: boolean
  error_message?: string
  intermediate_resume_count: number
}

export type GenerationNodeDetail = {
  id: number
  node_name: string
  provider: string
  model: string | null
  status: string
  latency_ms: number | null
  fallback_used: boolean
  parse_error: boolean
  error_message: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
  created_at: string
}

export type ModelBenchmarkItem = {
  model_name: string
  total_runs: number
  completed_runs: number
  failed_runs: number
  failure_rate: number
  avg_duration_seconds: number
  p50_duration_seconds: number
  p90_duration_seconds: number
  min_duration_seconds: number
  max_duration_seconds: number
  total_tokens: number
}

export type TemplateBenchmarkItem = {
  template_id: string
  total_runs: number
  avg_duration_seconds: number
}

export type NodeModelBenchmarkItem = {
  node_name: string
  provider: string
  model: string
  calls: number
  avg_latency_ms: number
  total_tokens: number
  errors: number
  fallbacks: number
}

export type SlowestRunItem = {
  id: string
  job_title: string
  company: string
  model_used: string
  template_id: string
  created_at: string
  completed_at: string
  email: string
  duration_seconds: number
}

export type TimingByModelResponse = {
  models_benchmark: ModelBenchmarkItem[]
  templates_benchmark: TemplateBenchmarkItem[]
  nodes_by_model: NodeModelBenchmarkItem[]
  slowest_runs: SlowestRunItem[]
}

export type UserItem = {
  id: string
  email: string
  name?: string
  created_at: string
  provider?: string
  is_pro?: boolean
  is_admin?: boolean
  request_count: number
  reset_at?: string
  daily_cap?: number
  monthly_cap?: number
  monthly_count?: number
  admin_note?: string
}

export type ModelTierConfig = {
  tier: string
  provider_name: string
  base_url: string
  model: string
  temperature: number
  fallback_provider?: string
  fallback_model?: string
  extra_headers?: Record<string, string>
  is_active: boolean
  updated_at?: string
}

export type ModelSettingsResponse = {
  free?: ModelTierConfig
  pro?: ModelTierConfig
}

export type LogItem = {
  id: number
  timestamp: string
  level: string
  message: string
  node_name?: string
}

export type PromptTestRun = {
  id: string
  prompt_name: string
  status: string
  output?: string
  latency_ms?: number
  error_message?: string
  created_at: string
}

export type StorageObject = {
  key: string
  size: number
  last_modified?: string
}

export type StorageList = {
  enabled: boolean
  objects: StorageObject[]
  next_cursor?: string
  error?: string
}

export type SupportAttachmentItem = {
  id: string
  file_type: "image" | "voice" | "file"
  file_key: string
  file_name: string
  content_type?: string
  created_at: string
  file_url?: string
}

export type SupportReportItem = {
  id: string
  user_id?: string
  email?: string
  category: string
  message: string
  status: "open" | "in_progress" | "resolved" | "closed"
  admin_notes?: string
  generation_id?: string
  sentiment_score?: number | null
  sentiment_reason?: string
  created_at: string
  resolved_at?: string
  attachment_count: number
  has_voice: boolean
}

export type SupportReportDetail = SupportReportItem & {
  attachments: SupportAttachmentItem[]
}

export type FeedbackRatingItem = {
  id: string
  user_id: string
  email?: string
  generation_id?: string
  star_rating: number
  comment?: string
  created_at: string
}

export type FeedbackAnalytics = {
  total_reports: number
  open_reports: number
  in_progress_reports: number
  resolved_reports: number
  closed_reports: number
  total_ratings: number
  average_star_rating: number
  rating_distribution: Record<number, number>
  reports_by_category: Record<string, number>
  avg_resolution_time_minutes?: number
}

export type AdminTabId =
  | "analytics"
  | "generations"
  | "timing"
  | "prompts"
  | "models"
  | "users"
  | "metrics"
  | "storage"
  | "templates"
  | "feedback"
