import type { LlmStatusSummary } from "@/components/admin/llm/types"

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
  llm_status?: LlmStatusSummary | null
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

export type FeedbackRatingItem = {
  id: string
  user_id: string
  user_email?: string
  user_name?: string
  generation_id?: string
  generation_job_title?: string
  star_rating: number
  comment?: string
  dismissed: boolean
  created_at: string
}

export type FeedbackAnalytics = {
  total_reports: number
  open_count: number
  resolved_count: number
  avg_rating: number
  total_ratings: number
  rating_distribution: Record<string, number>
  reports_by_category: Record<string, number>
}

export type ProductOverview = {
  days: number
  dates: string[]
  kpis: {
    total_users: number
    pro_users: number
    new_users_today: number
    new_users_7d: number
    new_users_prev_7d: number
    generations_today: number
    generations_7d: number
    generations_prev_7d: number
    builders_today: number
  }
  signups: number[]
  users_total: number[]
  generations: { completed: number[]; failed: number[]; other: number[]; guest: number[]; total: number[] }
  builders: number[]
}

export type BreakdownItem = { label: string; views: number; visitors: number }

export type PostHogOverviewData = {
  days: number
  generated_at: string
  truncated: boolean
  partial: boolean
  activity: {
    dates: string[]
    dau: number[]
    wau: number[]
    mau: number[]
    pageviews: number[]
    sessions: number[]
    kpis: {
      dau: number
      dau_prev: number
      wau: number
      wau_prev: number
      mau: number
      mau_prev: number
      pageviews_today: number
      pageviews_prev: number
      sessions_today: number
      sessions_prev: number
      active_now: number
      stickiness: number
    }
  }
  funnel: { id: string; label: string; event: string; value: number }[]
  breakdowns: Record<"pages" | "referrers" | "devices" | "countries" | "browsers", BreakdownItem[]>
}

export type PostHogOverview = {
  configured: boolean
  project_url: string | null
  days: number
  error: string | null
  data: PostHogOverviewData | null
}
