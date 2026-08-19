"use client"

import { useRef, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { 
  BarChart2, 
  Settings, 
  RefreshCw, 
  Trash2, 
  Users, 
  FileText, 
  Terminal, 
  Lock, 
  ArrowLeft,
  Database,
  Play,
  Boxes,
  Download,
  MoreHorizontal,
  MessageSquare,
  Star,
  Volume2,
  Image as ImageIcon,
  CheckCircle,
  MessageCircle,
  X,
  Cpu,
} from "lucide-react"

type AnalyticsData = {
  total_users: number
  total_generations: number
  generations_by_status: Record<string, number>
  total_guest_generations: number
  average_generation_latency_seconds: number
  failure_rate_percent: number
  keys_status: {
    openrouter?: { configured_keys_count: number; model?: string; base_url?: string }
    pro?: { configured_keys_count: number; model?: string; base_url?: string }
    google: { configured_keys_count: number; model?: string }
  }
  llm_metrics: MetricSummary
}

type MetricSummary = {
  total_tokens: number
  average_node_latency_ms: number
  fallback_count: number
  parse_error_count: number
  recorded_calls: number
}

type MetricNode = {
  node_name: string
  provider: string
  calls: number
  average_latency_ms: number
  errors: number
  fallbacks: number
  parse_errors: number
  total_tokens: number
}

type PromptConfig = {
  name: string
  system_prompt: string
  user_prompt?: string
  updated_at?: string
}

type GenerationItem = {
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
  is_guest: boolean
  error_message?: string
  intermediate_resume_count: number
}
type UserItem = {
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

type ModelTierConfig = {
  tier: string
  provider_name: string
  base_url: string
  model: string
  keys_count: number
  masked_keys: string[]
  temperature: number
  fallback_provider?: string
  fallback_model?: string
  extra_headers?: Record<string, string>
  is_active: boolean
  updated_at?: string
}

type ModelSettingsResponse = {
  free?: ModelTierConfig
  pro?: ModelTierConfig
}

const PRO_MODEL_PRESETS = [
  {
    name: "OmniRoute — Gemini 3.7 Flash Tiered (Recommended)",
    baseUrl: "https://omniroute-latest-rmm0.onrender.com/",
    model: "antigravity/gemini-3.7-flash-tiered",
    fallbackModel: "gemma-4-31b-it",
  },
  {
    name: "OpenRouter — Anthropic Claude 3.5 Sonnet",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "anthropic/claude-3.5-sonnet",
    fallbackModel: "gemma-4-31b-it",
  },
  {
    name: "OpenRouter — OpenAI GPT-4o",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o",
    fallbackModel: "gemma-4-31b-it",
  },
  {
    name: "OpenRouter — DeepSeek V3 (Chat)",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "deepseek/deepseek-chat",
    fallbackModel: "gemma-4-31b-it",
  },
  {
    name: "OpenRouter — Google Gemini 2.0 Flash",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "google/gemini-2.0-flash-001",
    fallbackModel: "gemma-4-31b-it",
  },
]

const FREE_MODEL_PRESETS = [
  {
    name: "OpenRouter — Poolside Laguna XS 2.1 (Free)",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "poolside/laguna-xs-2.1:free",
    fallbackModel: "gemma-4-31b-it",
  },
  {
    name: "OpenRouter — Meta Llama 3.3 70B Instruct",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "meta-llama/llama-3.3-70b-instruct",
    fallbackModel: "gemma-4-31b-it",
  },
  {
    name: "OpenRouter — DeepSeek R1 Distill Llama 70B (Free)",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "deepseek/deepseek-r1-distill-llama-70b:free",
    fallbackModel: "gemma-4-31b-it",
  },
  {
    name: "OpenRouter — Google Gemini 2.0 Flash Exp (Free)",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "google/gemini-2.0-flash-exp:free",
    fallbackModel: "gemma-4-31b-it",
  },
  {
    name: "OpenRouter — Qwen 2.5 72B Instruct",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "qwen/qwen-2.5-72b-instruct",
    fallbackModel: "gemma-4-31b-it",
  },
]
type LogItem = {
  id: number
  timestamp: string
  level: string
  message: string
  node_name?: string
}

type PromptTestRun = {
  id: string
  prompt_name: string
  status: string
  output?: string
  latency_ms?: number
  error_message?: string
  created_at: string
}

type StorageObject = {
  key: string
  size: number
  last_modified?: string
}

type StorageList = {
  enabled: boolean
  objects: StorageObject[]
  next_cursor?: string
  error?: string
}

type SupportReportItem = {
  id: string
  user_id?: string
  user_email?: string
  user_name?: string
  email_override?: string
  message: string
  status: string
  category?: string
  admin_note?: string
  auto_summary?: string
  sentiment_score?: number
  generation_id?: string
  created_at: string
  updated_at?: string
  resolved_at?: string
  attachment_count: number
}

type ReportAttachmentDetail = {
  id: string
  attachment_type: "screenshot" | "voice_recording"
  storage_key: string
  presigned_url?: string
  filename?: string
  mime_type?: string
  file_size_bytes?: number
  transcription?: string
  created_at: string
}

type SupportReportDetail = SupportReportItem & {
  attachments: ReportAttachmentDetail[]
}

type FeedbackRatingItem = {
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

type FeedbackAnalytics = {
  total_reports: number
  open_count: number
  resolved_count: number
  avg_rating: number
  total_ratings: number
  rating_distribution: Record<string, number>
  reports_by_category: Record<string, number>
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    if (res.status === 401) throw new Error("Unauthorized")
    if (res.status === 403) throw new Error("Access Denied")
    throw new Error(`Failed to load ${url}`)
  }
  return res.json()
}

export function AdminClient() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<"analytics" | "models" | "generations" | "prompts" | "users" | "metrics" | "storage" | "templates" | "feedback">("analytics")
  const [generationSearch, setGenerationSearch] = useState("")
  const [generationStatus, setGenerationStatus] = useState("")
  const [generationUserType, setGenerationUserType] = useState("")
  const [userSearch, setUserSearch] = useState("")
  const [storagePrefix, setStoragePrefix] = useState("")
  const [playgroundVariables, setPlaygroundVariables] = useState("{}")
  const [playgroundResult, setPlaygroundResult] = useState("")
  const [bulkCases, setBulkCases] = useState("[]")
  const [templateId, setTemplateId] = useState("personal-classic")
  const [templateContext, setTemplateContext] = useState("{}")
  const [templateHtml, setTemplateHtml] = useState("")

  // Model Settings States
  const [proBaseUrl, setProBaseUrl] = useState("")
  const [proModel, setProModel] = useState("")
  const [proApiKey, setProApiKey] = useState("")
  const [proTemperature, setProTemperature] = useState(0.2)
  const [proFallbackModel, setProFallbackModel] = useState("gemma-4-31b-it")

  const [freeBaseUrl, setFreeBaseUrl] = useState("")
  const [freeModel, setFreeModel] = useState("")
  const [freeApiKeys, setFreeApiKeys] = useState("")
  const [freeTemperature, setFreeTemperature] = useState(0.2)
  const [freeFallbackModel, setFreeFallbackModel] = useState("gemma-4-31b-it")

  const [testOutput, setTestOutput] = useState<{
    tier?: string
    success?: boolean
    latency_ms?: number
    output?: string
    model_used?: string
    error?: string
  } | null>(null)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  // Feedback Tab States
  const [feedbackSubTab, setFeedbackSubTab] = useState<"reports" | "ratings">("reports")
  const [reportSearch, setReportSearch] = useState("")
  const [reportStatusFilter, setReportStatusFilter] = useState("")
  const [reportCategoryFilter, setReportCategoryFilter] = useState("")
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [editingAdminNote, setEditingAdminNote] = useState("")
  const [editingReportStatus, setEditingReportStatus] = useState("open")
  
  // States for Prompt editor
  const [selectedPrompt, setSelectedPrompt] = useState<PromptConfig | null>(null)
  const [systemPromptVal, setSystemPromptVal] = useState("")
  const [userPromptVal, setUserPromptVal] = useState("")

  // States for log view
  const [viewingLogsGenId, setViewingLogsGenId] = useState<string | null>(null)
  const streamRef = useRef<EventSource | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [liveLogs, setLiveLogs] = useState<LogItem[]>([])

  // States for rate limit edit
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [newLimitVal, setNewLimitVal] = useState(5)

  // 1. Fetch Analytics
  const { data: analytics, error: analyticsErr, isLoading: loadingAnalytics } = useQuery<AnalyticsData>({
    queryKey: ["admin", "analytics"],
    queryFn: () => fetchJson<AnalyticsData>("/api/backend/admin/analytics"),
  })

  // Model Settings Query
  const { data: modelSettings, isLoading: loadingModelSettings } = useQuery<ModelSettingsResponse>({
    queryKey: ["admin", "model-settings"],
    queryFn: async () => {
      const data = await fetchJson<ModelSettingsResponse>("/api/backend/admin/model-settings")
      if (data.pro) {
        setProBaseUrl(data.pro.base_url || "https://omniroute-latest-rmm0.onrender.com/")
        setProModel(data.pro.model || "antigravity/gemini-3.7-flash-tiered")
        setProTemperature(data.pro.temperature ?? 0.2)
        setProFallbackModel(data.pro.fallback_model || "gemma-4-31b-it")
      }
      if (data.free) {
        setFreeBaseUrl(data.free.base_url || "https://openrouter.ai/api/v1")
        setFreeModel(data.free.model || "poolside/laguna-xs-2.1:free")
        setFreeTemperature(data.free.temperature ?? 0.2)
        setFreeFallbackModel(data.free.fallback_model || "gemma-4-31b-it")
      }
      return data
    },
    enabled: activeTab === "models" || activeTab === "analytics",
  })

  // 2. Fetch Prompts
  const { data: prompts = [], isLoading: loadingPrompts } = useQuery<PromptConfig[]>({
    queryKey: ["admin", "prompts"],
    queryFn: () => fetchJson<PromptConfig[]>("/api/backend/admin/prompts"),
    enabled: activeTab === "prompts",
  })

  // 3. Fetch Generations
  const { data: generations = [], isLoading: loadingGenerations } = useQuery<GenerationItem[]>({
    queryKey: ["admin", "generations", generationSearch, generationStatus, generationUserType],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "50" })
      if (generationSearch.trim()) params.set("search", generationSearch.trim())
      if (generationStatus) params.set("status_filter", generationStatus)
      if (generationUserType) params.set("user_type", generationUserType)
      return fetchJson<GenerationItem[]>(`/api/backend/admin/generations?${params}`)
    },
    enabled: activeTab === "generations",
  })

  // 4. Fetch Users
  const { data: users = [], isLoading: loadingUsers } = useQuery<UserItem[]>({
    queryKey: ["admin", "users", userSearch],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "50" })
      if (userSearch.trim()) params.set("search", userSearch.trim())
      return fetchJson<UserItem[]>(`/api/backend/admin/users?${params}`)
    },
    enabled: activeTab === "users",
  })

  // 5. Fetch logs for selected generation
  const { data: logs = [], isLoading: loadingLogs } = useQuery<LogItem[]>({
    queryKey: ["admin", "logs", viewingLogsGenId],
    queryFn: () => fetchJson<LogItem[]>(`/api/backend/admin/generations/${viewingLogsGenId}/logs`),
    enabled: !!viewingLogsGenId,
  })

  const { data: metricSummary } = useQuery<MetricSummary>({
    queryKey: ["admin", "metrics", "summary"],
    queryFn: () => fetchJson<MetricSummary>("/api/backend/admin/metrics/summary"),
    enabled: activeTab === "metrics",
  })

  const { data: metricNodes = [] } = useQuery<MetricNode[]>({
    queryKey: ["admin", "metrics", "nodes"],
    queryFn: () => fetchJson<MetricNode[]>("/api/backend/admin/metrics/nodes"),
    enabled: activeTab === "metrics",
  })

  const { data: promptRuns = [] } = useQuery<PromptTestRun[]>({
    queryKey: ["admin", "prompt-test-runs"],
    queryFn: () => fetchJson<PromptTestRun[]>("/api/backend/admin/prompts/test-runs"),
    enabled: activeTab === "prompts",
  })

  const { data: storageList } = useQuery<StorageList>({
    queryKey: ["admin", "storage", storagePrefix],
    queryFn: () => fetchJson<StorageList>(`/api/backend/admin/storage/objects?prefix=${encodeURIComponent(storagePrefix)}`),
    enabled: activeTab === "storage",
  })

  // Feedback Queries
  const { data: feedbackAnalytics } = useQuery<FeedbackAnalytics>({
    queryKey: ["admin", "feedback", "analytics"],
    queryFn: () => fetchJson<FeedbackAnalytics>("/api/backend/admin/feedback/analytics"),
    enabled: activeTab === "feedback",
  })

  const { data: supportReports = [], isLoading: loadingReports } = useQuery<SupportReportItem[]>({
    queryKey: ["admin", "feedback", "reports", reportSearch, reportStatusFilter, reportCategoryFilter],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "50" })
      if (reportSearch.trim()) params.set("search", reportSearch.trim())
      if (reportStatusFilter) params.set("status_filter", reportStatusFilter)
      if (reportCategoryFilter) params.set("category_filter", reportCategoryFilter)
      return fetchJson<SupportReportItem[]>(`/api/backend/admin/feedback/reports?${params}`)
    },
    enabled: activeTab === "feedback" && feedbackSubTab === "reports",
  })

  const { data: feedbackRatings = [], isLoading: loadingRatings } = useQuery<FeedbackRatingItem[]>({
    queryKey: ["admin", "feedback", "ratings"],
    queryFn: () => fetchJson<FeedbackRatingItem[]>("/api/backend/admin/feedback/ratings?limit=50"),
    enabled: activeTab === "feedback" && feedbackSubTab === "ratings",
  })

  const { data: selectedReportDetail } = useQuery<SupportReportDetail>({
    queryKey: ["admin", "feedback", "report", selectedReportId],
    queryFn: () => fetchJson<SupportReportDetail>(`/api/backend/admin/feedback/reports/${selectedReportId}`),
    enabled: !!selectedReportId,
  })

  // Feedback Mutations
  const updateReportStatusMutation = useMutation({
    mutationFn: async (payload: { id: string; status: string; admin_note?: string }) => {
      const res = await fetch(`/api/backend/admin/feedback/reports/${payload.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: payload.status, admin_note: payload.admin_note }),
      })
      if (!res.ok) throw new Error("Failed to update report")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "feedback"] })
      alert("Report updated successfully!")
    },
  })

  const deleteReportMutation = useMutation({
    mutationFn: async (reportId: string) => {
      const res = await fetch(`/api/backend/admin/feedback/reports/${reportId}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error("Failed to delete report")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "feedback"] })
      setSelectedReportId(null)
    },
  })

  // Mutations
  const updatePromptMutation = useMutation({
    mutationFn: async (payload: { name: string; system_prompt: string; user_prompt?: string }) => {
      const res = await fetch(`/api/backend/admin/prompts/${payload.name}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error("Failed to save prompt config")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "prompts"] })
      alert("Prompt updated successfully!")
    },
  })

  const retryGenMutation = useMutation({
    mutationFn: async (genId: string) => {
      const res = await fetch(`/api/backend/admin/generations/${genId}/retry`, {
        method: "POST",
      })
      if (!res.ok) throw new Error("Failed to retry generation")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "generations"] })
      alert("Generation restarted successfully!")
    },
  })

  const deleteGenMutation = useMutation({
    mutationFn: async (genId: string) => {
      const res = await fetch(`/api/backend/admin/generations/${genId}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error("Failed to delete generation")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "generations"] })
    },
  })

  const updateRateLimitMutation = useMutation({
    mutationFn: async (payload: { userId: string; request_count: number }) => {
      const res = await fetch(`/api/backend/admin/users/${payload.userId}/rate-limit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_count: payload.request_count }),
      })
      if (!res.ok) throw new Error("Failed to update rate limit")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
      setEditingUserId(null)
    },
  })

  const updateCreditsMutation = useMutation({
    mutationFn: async (payload: { userId: string; daily_cap: number; monthly_cap: number; admin_note?: string }) => {
      const res = await fetch(`/api/backend/admin/users/${payload.userId}/credits`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error("Failed to update credits")
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
  })

  const runPlaygroundMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPrompt) throw new Error("Select a prompt first")
      const res = await fetch("/api/backend/admin/prompts/playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt_name: selectedPrompt.name,
          system_prompt: systemPromptVal,
          user_prompt: userPromptVal,
          variables: JSON.parse(playgroundVariables),
        }),
      })
      if (!res.ok) throw new Error("Prompt playground failed")
      return res.json()
    },
    onSuccess: (data) => {
      setPlaygroundResult(data.output || data.error_message || "No output")
      queryClient.invalidateQueries({ queryKey: ["admin", "prompt-test-runs"] })
    },
  })

  const runBulkMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPrompt) throw new Error("Select a prompt first")
      const res = await fetch("/api/backend/admin/prompts/bulk-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt_name: selectedPrompt.name,
          system_prompt: systemPromptVal,
          user_prompt: userPromptVal,
          cases: JSON.parse(bulkCases),
        }),
      })
      if (!res.ok) throw new Error("Bulk test failed")
      return res.json()
    },
    onSuccess: (data) => {
      setPlaygroundResult(JSON.stringify(data.results, null, 2))
      queryClient.invalidateQueries({ queryKey: ["admin", "prompt-test-runs"] })
    },
  })

  const deleteStorageMutation = useMutation({
    mutationFn: async (key: string) => {
      const res = await fetch("/api/backend/admin/storage/object", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      })
      if (!res.ok) throw new Error("Delete failed")
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "storage"] }),
  })

  const renderTemplateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/backend/admin/templates/sandbox/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_id: templateId, context: JSON.parse(templateContext) }),
      })
      if (!res.ok) throw new Error("Template render failed")
      return res.json()
    },
    onSuccess: (data) => setTemplateHtml(data.html || ""),
  })

  const updateModelSettingsMutation = useMutation({
    mutationFn: async (tier: "free" | "pro") => {
      setSaveStatus(null)
      const payload = tier === "pro" ? {
        tier: "pro",
        base_url: proBaseUrl,
        model: proModel,
        api_keys: proApiKey ? [proApiKey] : undefined,
        temperature: proTemperature,
        fallback_provider: "google",
        fallback_model: proFallbackModel,
      } : {
        tier: "free",
        base_url: freeBaseUrl,
        model: freeModel,
        api_keys: freeApiKeys ? freeApiKeys.split(/[\n,]+/).map(k => k.trim()).filter(Boolean) : undefined,
        temperature: freeTemperature,
        fallback_provider: "google",
        fallback_model: freeFallbackModel,
      }

      const res = await fetch("/api/backend/admin/model-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error("Failed to update model settings")
      return res.json()
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "model-settings"] })
      queryClient.invalidateQueries({ queryKey: ["admin", "analytics"] })
      setSaveStatus(`Saved ${variables.toUpperCase()} tier settings successfully!`)
      setTimeout(() => setSaveStatus(null), 4000)
    },
  })

  const testModelMutation = useMutation({
    mutationFn: async (tier: "free" | "pro") => {
      setTestOutput(null)
      const payload = tier === "pro" ? {
        tier: "pro",
        base_url: proBaseUrl || undefined,
        model: proModel || undefined,
        api_key: proApiKey || undefined,
      } : {
        tier: "free",
        base_url: freeBaseUrl || undefined,
        model: freeModel || undefined,
        api_key: freeApiKeys ? freeApiKeys.split(/[\n,]+/).map(k => k.trim()).filter(Boolean)[0] : undefined,
      }

      const res = await fetch("/api/backend/admin/model-settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      return res.json()
    },
    onSuccess: (data) => {
      setTestOutput(data)
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Test failed"
      setTestOutput({ success: false, error: msg })
    },
  })

  const toggleUserTierMutation = useMutation({
    mutationFn: async ({ userId, is_pro }: { userId: string; is_pro: boolean }) => {
      const res = await fetch(`/api/backend/admin/users/${userId}/tier`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_pro }),
      })
      if (!res.ok) throw new Error("Failed to update user tier")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })

  // Access check
  if (analyticsErr?.message === "Access Denied" || analyticsErr?.message === "Unauthorized") {
    return (
      <div className="mx-auto max-w-md p-8 text-center bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 mt-12 pixel-enter">
        <Lock className="mx-auto text-red-500 mb-4" size={48} />
        <h2 className="text-xl font-bold uppercase text-red-600">Access Denied</h2>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400 text-sm font-semibold">
          Your account does not have admin permissions to access this control panel.
        </p>
      </div>
    )
  }

  const selectPromptForEditing = (p: PromptConfig) => {
    setSelectedPrompt(p)
    setSystemPromptVal(p.system_prompt)
    setUserPromptVal(p.user_prompt || "")
  }

  const exportLogs = () => {
    if (!viewingLogsGenId) return
    const lines = (liveLogs.length > 0 ? liveLogs : logs).map((log) => {
      const node = log.node_name ? `[${log.node_name}] ` : ""
      return `${log.timestamp} [${log.level}] ${node}${log.message}`
    })
    const blob = new Blob([lines.join("\n")], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `generation-${viewingLogsGenId}-logs.txt`
    link.click()
    URL.revokeObjectURL(url)
  }

  const startLogStream = () => {
    if (!viewingLogsGenId || streamRef.current) return
    setLiveLogs([])
    const stream = new EventSource(`/api/backend/admin/generations/${viewingLogsGenId}/stream`)
    streamRef.current = stream
    setIsStreaming(true)
    stream.addEventListener("log", (event) => {
      setLiveLogs((current) => [...current, JSON.parse((event as MessageEvent).data)])
    })
    stream.addEventListener("done", () => {
      stream.close()
      streamRef.current = null
      setIsStreaming(false)
      queryClient.invalidateQueries({ queryKey: ["admin", "logs", viewingLogsGenId] })
    })
    stream.onerror = () => {
      stream.close()
      streamRef.current = null
      setIsStreaming(false)
    }
  }

  const stopLogStream = () => {
    streamRef.current?.close()
    streamRef.current = null
    setIsStreaming(false)
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
      {/* Tab select bar */}
      <div className="flex flex-wrap gap-2 border-b border-zinc-200 dark:border-zinc-700 pb-3 mb-6">
        <Button 
          variant={activeTab === "analytics" ? "default" : "outline"} 
          onClick={() => setActiveTab("analytics")}
          size="sm"
        >
          <BarChart2 className="mr-2" size={16} /> Analytics
        </Button>
        <Button 
          variant={activeTab === "models" ? "default" : "outline"} 
          onClick={() => setActiveTab("models")}
          size="sm"
        >
          <Cpu className="mr-2" size={16} /> Model Providers
        </Button>
        <Button 
          variant={activeTab === "generations" ? "default" : "outline"} 
          onClick={() => setActiveTab("generations")}
          size="sm"
        >
          <FileText className="mr-2" size={16} /> Generations
        </Button>
        <Button 
          variant={activeTab === "prompts" ? "default" : "outline"} 
          onClick={() => setActiveTab("prompts")}
          size="sm"
        >
          <Settings className="mr-2" size={16} /> Prompt Manager
        </Button>
        <Button 
          variant={activeTab === "users" ? "default" : "outline"} 
          onClick={() => setActiveTab("users")}
          size="sm"
        >
          <Users className="mr-2" size={16} /> User Rate Limits
        </Button>
        <Button 
          variant={activeTab === "metrics" ? "default" : "outline"} 
          onClick={() => setActiveTab("metrics")}
          size="sm"
        >
          <Database className="mr-2" size={16} /> LLM Metrics
        </Button>
        <Button 
          variant={activeTab === "storage" ? "default" : "outline"} 
          onClick={() => setActiveTab("storage")}
          size="sm"
        >
          <Boxes className="mr-2" size={16} /> Storage
        </Button>
        <Button
          variant={activeTab === "templates" ? "default" : "outline"}
          onClick={() => setActiveTab("templates")}
          size="sm"
        >
          <Play className="mr-2" size={16} /> Templates
        </Button>
        <Button
          variant={activeTab === "feedback" ? "default" : "outline"}
          onClick={() => setActiveTab("feedback")}
          size="sm"
        >
          <MessageSquare className="mr-2" size={16} /> Feedback & Support
        </Button>
      </div>

      {/* ANALYTICS TAB */}
      {activeTab === "analytics" && (
        <div className="space-y-6 pixel-enter">
          {loadingAnalytics ? (
            <div className="soft-skeleton h-48" />
          ) : analytics ? (
            <>
              {/* Stat grid */}
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
                <div className="panel-strong p-4">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">Total Users</p>
                  <p className="text-3xl font-black text-black dark:text-white mt-1">{analytics.total_users}</p>
                </div>
                <div className="panel-strong p-4">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">Total Builds</p>
                  <p className="text-3xl font-black text-[#ff4e26] mt-1">{analytics.total_generations}</p>
                  <p className="mt-1 text-[10px] font-bold uppercase text-zinc-500">{analytics.total_guest_generations} guest</p>
                </div>
                <div className="panel-strong p-4">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">Avg Latency</p>
                  <p className="text-3xl font-black text-black dark:text-white mt-1">{analytics.average_generation_latency_seconds}s</p>
                </div>
                <div className="panel-strong p-4">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">LLM Failure Rate</p>
                  <p className="text-3xl font-black mt-1 text-red-600">{analytics.failure_rate_percent}%</p>
                </div>
              </div>

              {/* Advanced info section */}
              <div className="grid gap-6 md:grid-cols-2">
                {/* Generation Queue Breakdown */}
                <div className="panel-strong p-5 space-y-4">
                  <h3 className="text-sm font-bold uppercase tracking-wide border-b dark:border-zinc-700 pb-2 text-zinc-800 dark:text-zinc-200">Generation Queue</h3>
                  <div className="space-y-3">
                    {Object.entries(analytics.generations_by_status).map(([status, count]) => {
                      const percent = analytics.total_generations > 0 ? (count / analytics.total_generations * 100) : 0
                      let barColor = "bg-zinc-500"
                      if (status === "completed") barColor = "bg-green-500"
                      if (status === "failed") barColor = "bg-red-500"
                      if (status === "in_progress") barColor = "bg-[#ff4e26]"

                      return (
                        <div key={status} className="space-y-1">
                          <div className="flex justify-between text-xs font-semibold">
                            <span className="capitalize">{status}</span>
                            <span>{count} ({Math.round(percent)}%)</span>
                          </div>
                          <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-2.5 rounded-none overflow-hidden">
                            <div className={`h-full ${barColor}`} style={{ width: `${percent}%` }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* API Key pool Status */}
                <div className="panel-strong p-5 space-y-4">
                  <h3 className="text-sm font-bold uppercase tracking-wide border-b dark:border-zinc-700 pb-2 text-zinc-800 dark:text-zinc-200">LLM Provider Status</h3>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="border border-zinc-200 dark:border-zinc-700 p-3 text-center bg-zinc-50 dark:bg-zinc-800">
                      <p className="text-[10px] font-bold text-zinc-600 dark:text-zinc-400 uppercase">OmniRoute (Pro)</p>
                      <p className="text-sm font-black text-[#ff4e26] mt-1 truncate" title={analytics.keys_status.pro?.model || "antigravity/gemini-3.7-flash-tiered"}>
                        {analytics.keys_status.pro?.model ? (analytics.keys_status.pro.model.includes("/") ? analytics.keys_status.pro.model.split("/").slice(1).join("/") : analytics.keys_status.pro.model) : "Gemini 3.7 Tiered"}
                      </p>
                      <span className="text-[9px] text-green-600 font-bold uppercase">Pro Tier</span>
                    </div>
                    <div className="border border-zinc-200 dark:border-zinc-700 p-3 text-center bg-zinc-50 dark:bg-zinc-800">
                      <p className="text-[10px] font-bold text-zinc-600 dark:text-zinc-400 uppercase">OpenRouter Keys</p>
                      <p className="text-sm font-black text-black dark:text-white mt-1 truncate" title={analytics.keys_status.openrouter?.model || "poolside/laguna-xs-2.1:free"}>
                        {analytics.keys_status.openrouter?.model ? (analytics.keys_status.openrouter.model.includes("/") ? analytics.keys_status.openrouter.model.split("/").slice(1).join("/") : analytics.keys_status.openrouter.model) : "Laguna XS"} ({analytics.keys_status.openrouter?.configured_keys_count ?? 0} keys)
                      </p>
                    </div>
                    <div className="border border-zinc-200 dark:border-zinc-700 p-3 text-center bg-zinc-50 dark:bg-zinc-800">
                      <p className="text-[10px] font-bold text-zinc-600 dark:text-zinc-400 uppercase">Google Fallback</p>
                      <p className="text-lg font-black text-black dark:text-white mt-1">{analytics.keys_status.google.configured_keys_count} keys</p>
                      <span className="text-[9px] text-amber-600 font-bold uppercase">Fallback</span>
                    </div>
                  </div>
                  <div className="flex justify-between items-center text-[11px] text-zinc-500 dark:text-zinc-400 font-semibold">
                    <span>Dynamic runtime config with zero-downtime hot reload.</span>
                    <Button size="xs" variant="outline" onClick={() => setActiveTab("models")}>
                      Manage Providers &rarr;
                    </Button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <p>No data loaded.</p>
          )}
        </div>
      )}

      {/* MODEL PROVIDERS TAB */}
      {activeTab === "models" && (
        <div className="space-y-6 pixel-enter">
          <div className="flex flex-wrap justify-between items-center gap-2 border-b dark:border-zinc-700 pb-3">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wide">Dynamic LLM & Model Provider Settings</h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Configure endpoints, models, and API keys for Pro and Free accounts. Changes take effect instantly without restarting the server.
              </p>
            </div>
            {saveStatus && (
              <span className="text-xs font-bold text-green-600 bg-green-50 dark:bg-green-950 border border-green-300 dark:border-green-800 px-2.5 py-1">
                {saveStatus}
              </span>
            )}
          </div>

          {loadingModelSettings ? (
            <div className="soft-skeleton h-64" />
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {/* PRO TIER SETTINGS */}
              <div className="panel-strong p-5 space-y-4 border-2 border-[#ff4e26]">
                <div className="flex justify-between items-center border-b dark:border-zinc-700 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 bg-[#ff4e26] rounded-full inline-block" />
                    <h4 className="text-sm font-black uppercase text-black dark:text-white">Pro Accounts (Premium Tier)</h4>
                  </div>
                  <span className="px-2 py-0.5 font-bold uppercase text-[9px] bg-red-100 dark:bg-red-950 text-[#ff4e26] border border-[#ff4e26]">
                    OmniRoute Gateway
                  </span>
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  Used exclusively for Pro users (Admins & promoted users). High-capacity Google Gemini 3.7 Flash Tiered.
                </p>

                  {/* Pro Model Presets */}
                  <div>
                    <Label className="text-xs font-bold">Quick Presets (Auto-fill)</Label>
                    <select
                      className="w-full h-8 text-xs border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 mt-1 font-sans"
                      onChange={(e) => {
                        const preset = PRO_MODEL_PRESETS.find(p => p.model === e.target.value)
                        if (preset) {
                          setProBaseUrl(preset.baseUrl)
                          setProModel(preset.model)
                          setProFallbackModel(preset.fallbackModel)
                        }
                      }}
                      value={PRO_MODEL_PRESETS.some(p => p.model === proModel) ? proModel : ""}
                    >
                      <option value="">Choose a pre-registered Pro model...</option>
                      {PRO_MODEL_PRESETS.map((p) => (
                        <option key={p.model} value={p.model}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <div className="flex flex-wrap gap-1.5 pt-1.5">
                      {PRO_MODEL_PRESETS.map((p) => (
                        <button
                          key={p.model}
                          type="button"
                          onClick={() => {
                            setProBaseUrl(p.baseUrl)
                            setProModel(p.model)
                            setProFallbackModel(p.fallbackModel)
                          }}
                          className={`text-[10px] px-2 py-0.5 font-bold border transition-colors ${proModel === p.model ? "bg-[#ff4e26] text-white border-[#ff4e26]" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:border-zinc-500"}`}
                        >
                          {p.model.split("/").pop()}
                        </button>
                      ))}
                    </div>
                  </div>

                <div className="space-y-3">
                  <div>
                    <Label className="text-xs font-bold">Provider Base URL</Label>
                    <Input
                      value={proBaseUrl}
                      onChange={(e) => setProBaseUrl(e.target.value)}
                      placeholder="https://omniroute-latest-rmm0.onrender.com/"
                      className="h-8 text-xs font-mono mt-1"
                    />
                    <p className="text-[10px] text-zinc-400 mt-0.5">OpenAI-compatible gateway endpoint</p>
                  </div>

                  <div>
                    <Label className="text-xs font-bold">Model ID / Name</Label>
                    <Input
                      value={proModel}
                      onChange={(e) => setProModel(e.target.value)}
                      placeholder="antigravity/gemini-3.7-flash-tiered"
                      className="h-8 text-xs font-mono mt-1"
                    />
                  </div>

                  <div>
                    <Label className="text-xs font-bold">Bearer Token / API Key (Optional)</Label>
                    <Input
                      type="password"
                      value={proApiKey}
                      onChange={(e) => setProApiKey(e.target.value)}
                      placeholder={modelSettings?.pro?.masked_keys?.[0] || "Leave blank if gateway requires no auth"}
                      className="h-8 text-xs font-mono mt-1"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs font-bold">Temperature</Label>
                      <Input
                        type="number"
                        step="0.05"
                        min="0.0"
                        max="1.0"
                        value={proTemperature}
                        onChange={(e) => setProTemperature(parseFloat(e.target.value) || 0.2)}
                        className="h-8 text-xs font-mono mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-bold">Fallback Model</Label>
                      <Input
                        value={proFallbackModel}
                        onChange={(e) => setProFallbackModel(e.target.value)}
                        placeholder="gemma-4-31b-it"
                        className="h-8 text-xs font-mono mt-1"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2 border-t dark:border-zinc-700">
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={updateModelSettingsMutation.isPending}
                      onClick={() => updateModelSettingsMutation.mutate("pro")}
                    >
                      Save Pro Settings
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={testModelMutation.isPending}
                      onClick={() => testModelMutation.mutate("pro")}
                    >
                      {testModelMutation.isPending && testOutput?.tier === "pro" ? "Testing..." : "Test Connection"}
                    </Button>
                  </div>
                </div>
              </div>

              {/* FREE TIER SETTINGS */}
              <div className="panel-strong p-5 space-y-4 border border-zinc-300 dark:border-zinc-700">
                <div className="flex justify-between items-center border-b dark:border-zinc-700 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 bg-zinc-400 rounded-full inline-block" />
                    <h4 className="text-sm font-black uppercase text-black dark:text-white">Free Accounts (Standard Tier)</h4>
                  </div>
                  <span className="px-2 py-0.5 font-bold uppercase text-[9px] bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-300 dark:border-zinc-700">
                    OpenRouter Pool
                  </span>
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  Used for standard registered users and guests. Multi-key round-robin rotation via OpenRouter.
                </p>

                  {/* Free Model Presets */}
                  <div>
                    <Label className="text-xs font-bold">Quick Presets (Auto-fill)</Label>
                    <select
                      className="w-full h-8 text-xs border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 mt-1 font-sans"
                      onChange={(e) => {
                        const preset = FREE_MODEL_PRESETS.find(p => p.model === e.target.value)
                        if (preset) {
                          setFreeBaseUrl(preset.baseUrl)
                          setFreeModel(preset.model)
                          setFreeFallbackModel(preset.fallbackModel)
                        }
                      }}
                      value={FREE_MODEL_PRESETS.some(p => p.model === freeModel) ? freeModel : ""}
                    >
                      <option value="">Choose a pre-registered Free model...</option>
                      {FREE_MODEL_PRESETS.map((p) => (
                        <option key={p.model} value={p.model}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <div className="flex flex-wrap gap-1.5 pt-1.5">
                      {FREE_MODEL_PRESETS.map((p) => (
                        <button
                          key={p.model}
                          type="button"
                          onClick={() => {
                            setFreeBaseUrl(p.baseUrl)
                            setFreeModel(p.model)
                            setFreeFallbackModel(p.fallbackModel)
                          }}
                          className={`text-[10px] px-2 py-0.5 font-bold border transition-colors ${freeModel === p.model ? "bg-black dark:bg-white text-white dark:text-black border-black dark:border-white" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:border-zinc-500"}`}
                        >
                          {p.model.split("/").pop()}
                        </button>
                      ))}
                    </div>
                  </div>

                <div className="space-y-3">
                  <div>
                    <Label className="text-xs font-bold">Provider Base URL</Label>
                    <Input
                      value={freeBaseUrl}
                      onChange={(e) => setFreeBaseUrl(e.target.value)}
                      placeholder="https://openrouter.ai/api/v1"
                      className="h-8 text-xs font-mono mt-1"
                    />
                  </div>

                  <div>
                    <Label className="text-xs font-bold">Model ID / Name</Label>
                    <Input
                      value={freeModel}
                      onChange={(e) => setFreeModel(e.target.value)}
                      placeholder="poolside/laguna-xs-2.1:free"
                      className="h-8 text-xs font-mono mt-1"
                    />
                    <p className="text-[10px] text-zinc-400 mt-0.5">e.g. poolside/laguna-xs-2.1:free</p>
                  </div>

                  <div>
                    <div className="flex justify-between items-center">
                      <Label className="text-xs font-bold">OpenRouter API Keys (comma or line separated)</Label>
                      <span className="text-[10px] font-mono text-zinc-500">
                        {modelSettings?.free?.keys_count ?? 0} active in pool
                      </span>
                    </div>
                    <Textarea
                      rows={3}
                      value={freeApiKeys}
                      onChange={(e) => setFreeApiKeys(e.target.value)}
                      placeholder={modelSettings?.free?.masked_keys?.join("\n") || "Paste sk-or-v1-... keys here"}
                      className="text-xs font-mono mt-1"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs font-bold">Temperature</Label>
                      <Input
                        type="number"
                        step="0.05"
                        min="0.0"
                        max="1.0"
                        value={freeTemperature}
                        onChange={(e) => setFreeTemperature(parseFloat(e.target.value) || 0.2)}
                        className="h-8 text-xs font-mono mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-bold">Fallback Model</Label>
                      <Input
                        value={freeFallbackModel}
                        onChange={(e) => setFreeFallbackModel(e.target.value)}
                        placeholder="gemma-4-31b-it"
                        className="h-8 text-xs font-mono mt-1"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2 border-t dark:border-zinc-700">
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={updateModelSettingsMutation.isPending}
                      onClick={() => updateModelSettingsMutation.mutate("free")}
                    >
                      Save Free Settings
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={testModelMutation.isPending}
                      onClick={() => testModelMutation.mutate("free")}
                    >
                      {testModelMutation.isPending && testOutput?.tier === "free" ? "Testing..." : "Test Connection"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TEST CONNECTION OUTPUT */}
          {testOutput && (
            <div className={`panel-strong p-4 space-y-2 border-2 ${testOutput.success ? "border-green-600 bg-green-50/20" : "border-red-600 bg-red-50/20"}`}>
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold uppercase tracking-wide">
                  {testOutput.success ? "✓ Test Succeeded" : "✕ Test Failed"} ({testOutput.tier?.toUpperCase()} Tier)
                </span>
                {testOutput.latency_ms !== undefined && (
                  <span className="text-xs font-mono font-bold text-zinc-500">
                    Latency: {testOutput.latency_ms}ms
                  </span>
                )}
              </div>
              {testOutput.model_used && (
                <p className="text-xs font-mono text-zinc-600 dark:text-zinc-400">
                  Model Responded: <strong>{testOutput.model_used}</strong>
                </p>
              )}
              {testOutput.output && (
                <pre className="text-xs p-2 bg-black text-green-400 font-mono overflow-x-auto rounded-none">
                  {testOutput.output}
                </pre>
              )}
              {testOutput.error && (
                <p className="text-xs font-bold text-red-600 font-mono">
                  {testOutput.error}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* GENERATIONS TAB */}
      {activeTab === "generations" && (
        <div className="space-y-4 pixel-enter">
          {viewingLogsGenId ? (
            <div className="panel-strong p-5 space-y-4">
              <div className="flex flex-wrap justify-between gap-2 items-center border-b pb-3">
                <h3 className="font-bold uppercase text-sm tracking-wide">Logs for Generation {viewingLogsGenId}</h3>
                <div className="flex gap-2">
                  <Button size="xs" variant="outline" onClick={isStreaming ? stopLogStream : startLogStream}>
                    {isStreaming ? "Stop live" : "Live stream"}
                  </Button>
                  <Button size="xs" variant="outline" onClick={exportLogs} disabled={logs.length === 0 && liveLogs.length === 0}>
                    Export logs
                  </Button>
                  <Button size="xs" variant="outline" onClick={() => setViewingLogsGenId(null)}>
                    <ArrowLeft className="mr-1" size={12} /> Back to generations
                  </Button>
                </div>
              </div>

              {loadingLogs ? (
                <div className="soft-skeleton h-40" />
              ) : logs.length === 0 && liveLogs.length === 0 ? (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 font-semibold italic text-center py-8">No logs found for this run.</p>
              ) : (
                <div className="bg-zinc-950 p-4 text-white font-mono text-xs overflow-y-auto max-h-[450px] space-y-1.5 leading-relaxed">
                  {(liveLogs.length > 0 ? liveLogs : logs).map((log) => {
                    let levelColor = "text-zinc-400"
                    if (log.level === "error") levelColor = "text-red-400"
                    if (log.level === "warning") levelColor = "text-amber-400"

                    return (
                      <div key={log.id} className="flex gap-2 items-start">
                        <span className="text-zinc-500">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                        <span className={`uppercase font-bold ${levelColor}`}>[{log.level}]</span>
                        {log.node_name && <span className="text-cyan-400">[{log.node_name}]</span>}
                        <span className="flex-1 break-all">{log.message}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-sm font-bold uppercase tracking-wide">Recent Generations</h3>
                <Button size="xs" variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ["admin", "generations"] })}>
                  <RefreshCw size={12} className="mr-1" /> Refresh
                </Button>
              </div>

              <div className="grid gap-2 rounded-none border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 md:grid-cols-[1fr_160px_160px]">
                <Input
                  value={generationSearch}
                  onChange={(e) => setGenerationSearch(e.target.value)}
                  placeholder="Search job, company, model, email"
                  className="h-9 text-xs"
                />
                <select
                  value={generationStatus}
                  onChange={(e) => setGenerationStatus(e.target.value)}
                  className="h-9 border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 text-xs font-semibold"
                >
                  <option value="">All statuses</option>
                  <option value="pending">Pending</option>
                  <option value="in_progress">In progress</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                </select>
                <select
                  value={generationUserType}
                  onChange={(e) => setGenerationUserType(e.target.value)}
                  className="h-9 border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 text-xs font-semibold"
                >
                  <option value="">All users</option>
                  <option value="user">Signed-in</option>
                  <option value="guest">Guest</option>
                </select>
              </div>

              {loadingGenerations ? (
                <div className="soft-skeleton h-64" />
              ) : generations.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400 italic py-12 text-center bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700">No generations run yet.</p>
              ) : (
                <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700 font-bold text-zinc-700 dark:text-zinc-300">
                        <th className="p-3">Job & User</th>
                        <th className="p-3">Model</th>
                        <th className="p-3">Status</th>
                        <th className="p-3">Created</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700 font-medium">
                      {generations.map((gen) => {
                        let statusColor = "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                        if (gen.status === "completed") statusColor = "bg-green-100 dark:bg-green-950/60 text-green-700 dark:text-green-300"
                        if (gen.status === "failed") statusColor = "bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300"
                        if (gen.status === "in_progress") statusColor = "bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 animate-pulse"

                        return (
                          <tr key={gen.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800">
                            <td className="p-3">
                              <p className="font-extrabold uppercase text-black dark:text-white">
                                {gen.job_title || "Unknown title"}
                              </p>
                              <p className="text-[10px] text-zinc-500">
                                {gen.company || "No company"} &bull; {gen.email || (gen.is_guest ? "Guest" : gen.user_id)}
                              </p>
                            </td>
                            <td className="p-3 text-zinc-600 dark:text-zinc-400 font-mono text-[10px]">{gen.model_used}</td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 font-bold uppercase text-[9px] ${statusColor}`}>
                                {gen.status}
                              </span>
                              {gen.error_message && (
                                <p className="mt-1 max-w-xs truncate text-[10px] font-semibold text-red-600" title={gen.error_message}>
                                  {gen.error_message}
                                </p>
                              )}
                            </td>
                            <td className="p-3 text-zinc-500 dark:text-zinc-400 font-mono text-[10px]">
                              {new Date(gen.created_at).toLocaleString()}
                            </td>
                            <td className="p-3 text-right">
                              <details className="relative inline-block text-left">
                                <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-300 transition hover:bg-zinc-200 dark:hover:bg-zinc-700">
                                  <MoreHorizontal size={13} /> Options
                                </summary>
                                <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-1 text-left shadow-lg">
                                  <button
                                    type="button"
                                    className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                                    onClick={() => {
                                      stopLogStream()
                                      setLiveLogs([])
                                      setViewingLogsGenId(gen.id)
                                    }}
                                  >
                                    <Terminal size={12} /> Logs
                                  </button>
                                  <button
                                    type="button"
                                    className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:hover:bg-zinc-800 disabled:text-zinc-300"
                                    disabled={gen.status !== "completed"}
                                    onClick={() => { window.location.href = `/api/backend/admin/generations/${gen.id}/download` }}
                                  >
                                    <Download size={12} /> Final resume
                                  </button>
                                  <button
                                    type="button"
                                    className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:hover:bg-zinc-800 disabled:text-zinc-300"
                                    disabled={gen.intermediate_resume_count === 0}
                                    onClick={() => { window.location.href = `/api/backend/admin/generations/${gen.id}/intermediate/0/download` }}
                                  >
                                    <FileText size={12} /> Intermediate
                                  </button>
                                  <button
                                    type="button"
                                    className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:hover:bg-zinc-800 disabled:text-zinc-300"
                                    disabled={gen.status !== "failed"}
                                    onClick={() => retryGenMutation.mutate(gen.id)}
                                  >
                                    <RefreshCw size={12} /> Retry
                                  </button>
                                  <button
                                    type="button"
                                    className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"
                                    onClick={() => {
                                      if (confirm("Delete this generation and its storage artifacts?")) {
                                        deleteGenMutation.mutate(gen.id)
                                      }
                                    }}
                                  >
                                    <Trash2 size={12} /> Delete
                                  </button>
                                </div>
                              </details>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* PROMPT MANAGER TAB */}
      {activeTab === "prompts" && (
        <div className="grid gap-6 md:grid-cols-[250px_1fr] pixel-enter">
          {/* Prompt Selection List */}
          <div className="panel-strong p-4 space-y-3">
            <h3 className="text-xs font-extrabold uppercase tracking-widest text-[#ff4e26]">Prompt list</h3>
            <div className="space-y-1">
              {loadingPrompts ? (
                <div className="soft-skeleton h-24" />
              ) : prompts.length === 0 ? (
                <p className="text-xs text-zinc-500 italic">No prompts registered in database. Run a generation to seed them.</p>
              ) : (
                prompts.map((p) => (
                  <button
                    key={p.name}
                    className={`w-full text-left px-3 py-2 text-xs font-semibold border transition-colors ${
                      selectedPrompt?.name === p.name
                        ? "border-[#ff4e26] bg-orange-50 text-[#ff4e26]"
                        : "border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:hover:bg-zinc-800"
                    }`}
                    onClick={() => selectPromptForEditing(p)}
                  >
                    {p.name}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Prompt Editor */}
          <div className="panel-strong p-5 space-y-4">
            {selectedPrompt ? (
              <>
                <div className="flex justify-between items-center border-b pb-3">
                  <h3 className="font-bold text-black dark:text-white uppercase text-sm">Edit Prompt: {selectedPrompt.name}</h3>
                  <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono">
                    Last updated: {selectedPrompt.updated_at ? new Date(selectedPrompt.updated_at).toLocaleString() : "Never"}
                  </span>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="system-prompt" className="text-xs font-bold text-zinc-700">System Prompt</Label>
                    <Textarea 
                      id="system-prompt"
                      rows={12}
                      className="font-mono text-xs leading-relaxed"
                      value={systemPromptVal}
                      onChange={(e) => setSystemPromptVal(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="user-prompt" className="text-xs font-bold text-zinc-700">User Prompt Template (Optional)</Label>
                    <Textarea 
                      id="user-prompt"
                      rows={5}
                      className="font-mono text-xs leading-relaxed"
                      value={userPromptVal}
                      onChange={(e) => setUserPromptVal(e.target.value)}
                      placeholder="Enter user prompt template here (use {curly_braces} for variables)"
                    />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <Button 
                      disabled={updatePromptMutation.isPending}
                      onClick={() => updatePromptMutation.mutate({
                        name: selectedPrompt.name,
                        system_prompt: systemPromptVal,
                        user_prompt: userPromptVal || undefined
                      })}
                    >
                      {updatePromptMutation.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>

                  <div className="border-t pt-4 space-y-3">
                    <h4 className="text-xs font-extrabold uppercase tracking-widest text-[#ff4e26]">Prompt Playground</h4>
                    <Textarea
                      rows={5}
                      className="font-mono text-xs"
                      value={playgroundVariables}
                      onChange={(e) => setPlaygroundVariables(e.target.value)}
                      placeholder='{"job_desc":"..."}'
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button size="xs" onClick={() => runPlaygroundMutation.mutate()} disabled={runPlaygroundMutation.isPending}>
                        Run Once
                      </Button>
                      <Button size="xs" variant="outline" onClick={() => runBulkMutation.mutate()} disabled={runBulkMutation.isPending}>
                        Run Bulk Cases
                      </Button>
                    </div>
                    <Textarea
                      rows={4}
                      className="font-mono text-xs"
                      value={bulkCases}
                      onChange={(e) => setBulkCases(e.target.value)}
                      placeholder='[{"job_desc":"case 1"},{"job_desc":"case 2"}]'
                    />
                    {playgroundResult && (
                      <pre className="max-h-60 overflow-auto bg-zinc-950 p-3 text-xs text-white whitespace-pre-wrap">{playgroundResult}</pre>
                    )}
                    <div className="space-y-2">
                      <h5 className="text-[10px] font-extrabold uppercase text-zinc-500">Recent test runs</h5>
                      {promptRuns.slice(0, 5).map((run) => (
                        <div key={run.id} className="border border-zinc-200 dark:border-zinc-700 p-2 text-xs">
                          <div className="flex justify-between font-bold">
                            <span>{run.prompt_name}</span>
                            <span>{run.status} · {Math.round(run.latency_ms || 0)}ms</span>
                          </div>
                          <p className="mt-1 truncate text-zinc-500">{run.output || run.error_message || "No output"}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="h-64 flex items-center justify-center text-zinc-400 text-sm font-semibold italic">
                Select a prompt from the sidebar to view and edit its template.
              </div>
            )}
          </div>
        </div>
      )}

      {/* LLM METRICS TAB */}
      {activeTab === "metrics" && (
        <div className="space-y-4 pixel-enter">
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-5">
            <div className="panel-strong p-4">
              <p className="text-[10px] font-extrabold uppercase text-zinc-500">Calls</p>
              <p className="text-2xl font-black">{metricSummary?.recorded_calls ?? 0}</p>
            </div>
            <div className="panel-strong p-4">
              <p className="text-[10px] font-extrabold uppercase text-zinc-500">Tokens</p>
              <p className="text-2xl font-black">{metricSummary?.total_tokens ?? 0}</p>
            </div>
            <div className="panel-strong p-4">
              <p className="text-[10px] font-extrabold uppercase text-zinc-500">Avg Latency</p>
              <p className="text-2xl font-black">{metricSummary?.average_node_latency_ms ?? 0}ms</p>
            </div>
            <div className="panel-strong p-4">
              <p className="text-[10px] font-extrabold uppercase text-zinc-500">Fallbacks</p>
              <p className="text-2xl font-black text-amber-600">{metricSummary?.fallback_count ?? 0}</p>
            </div>
            <div className="panel-strong p-4">
              <p className="text-[10px] font-extrabold uppercase text-zinc-500">Parse Errors</p>
              <p className="text-2xl font-black text-red-600">{metricSummary?.parse_error_count ?? 0}</p>
            </div>
          </div>
          <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-100 dark:bg-zinc-800 font-bold text-zinc-700 dark:text-zinc-300">
                <tr><th className="p-3">Node</th><th className="p-3">Provider</th><th className="p-3">Calls</th><th className="p-3">Avg Latency</th><th className="p-3">Errors</th><th className="p-3">Tokens</th></tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                {metricNodes.map((row) => (
                  <tr key={`${row.node_name}-${row.provider}`}>
                    <td className="p-3 font-bold">{row.node_name}</td>
                    <td className="p-3">{row.provider}</td>
                    <td className="p-3">{row.calls}</td>
                    <td className="p-3">{row.average_latency_ms}ms</td>
                    <td className="p-3">{row.errors} errors · {row.fallbacks} fallbacks · {row.parse_errors} parse</td>
                    <td className="p-3">{row.total_tokens}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* STORAGE TAB */}
      {activeTab === "storage" && (
        <div className="space-y-4 pixel-enter">
          <div className="rounded-none border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 flex gap-2">
            <Input value={storagePrefix} onChange={(e) => setStoragePrefix(e.target.value)} placeholder="Prefix filter" className="h-9 text-xs" />
            <Button size="sm" variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ["admin", "storage"] })}>Refresh</Button>
          </div>
          {storageList?.error && <p className="text-sm font-bold text-red-600">{storageList.error}</p>}
          <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-100 dark:bg-zinc-800 font-bold text-zinc-700 dark:text-zinc-300">
                <tr><th className="p-3">Key</th><th className="p-3">Size</th><th className="p-3">Modified</th><th className="p-3 text-right">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                {(storageList?.objects ?? []).map((obj) => (
                  <tr key={obj.key}>
                    <td className="p-3 font-mono break-all">{obj.key}</td>
                    <td className="p-3">{obj.size} bytes</td>
                    <td className="p-3">{obj.last_modified ? new Date(obj.last_modified).toLocaleString() : "-"}</td>
                    <td className="p-3 text-right space-x-1.5">
                      <Button size="xs" variant="outline" onClick={() => window.open(`/api/backend/admin/storage/object?key=${encodeURIComponent(obj.key)}`, "_blank")}>Meta</Button>
                      <Button size="xs" variant="ghost" onClick={() => confirm("Delete object?") && deleteStorageMutation.mutate(obj.key)}>Delete</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TEMPLATE SANDBOX TAB */}
      {activeTab === "templates" && (
        <div className="grid gap-4 md:grid-cols-2 pixel-enter">
          <div className="panel-strong p-4 space-y-3">
            <Label className="text-xs font-bold">Template ID</Label>
            <Input value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="h-9 text-xs" />
            <Label className="text-xs font-bold">Render Context JSON</Label>
            <Textarea rows={16} className="font-mono text-xs" value={templateContext} onChange={(e) => setTemplateContext(e.target.value)} />
            <Button onClick={() => renderTemplateMutation.mutate()} disabled={renderTemplateMutation.isPending}>Render Sandbox</Button>
          </div>
          <div className="panel-strong p-4">
            {templateHtml ? (
              <iframe className="h-[650px] w-full border border-zinc-200" srcDoc={templateHtml} />
            ) : (
              <div className="flex h-64 items-center justify-center text-sm font-semibold text-zinc-400">Render output appears here.</div>
            )}
          </div>
        </div>
      )}

      {/* USER RATE LIMITS TAB */}
      {activeTab === "users" && (
        <div className="space-y-4 pixel-enter">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-sm font-bold uppercase tracking-wide">User Account Limit Overview</h3>
          </div>

          <div className="rounded-none border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3">
            <Input
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Search users by email or name"
              className="h-9 text-xs"
            />
          </div>

          {loadingUsers ? (
            <div className="soft-skeleton h-64" />
          ) : (
            <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700 font-bold text-zinc-700 dark:text-zinc-300">
                    <th className="p-3">Name & Email</th>
                    <th className="p-3">Tier</th>
                    <th className="p-3">Joined Date</th>
                    <th className="p-3">Used Count (24h)</th>
                    <th className="p-3">Caps</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700 font-medium">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800">
                      <td className="p-3">
                        <div className="flex items-center gap-1.5">
                          <p className="font-bold text-black dark:text-white">{u.name || "No name"}</p>
                          {u.is_admin && (
                            <span className="px-1.5 py-0.2 text-[9px] font-extrabold uppercase bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-800">Admin</span>
                          )}
                        </div>
                        <p className="text-[10px] text-zinc-500">{u.email}</p>
                      </td>
                      <td className="p-3">
                        {u.is_pro ? (
                          <span className="px-2 py-0.5 font-bold uppercase text-[9px] bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300 border border-green-300 dark:border-green-800">
                            ★ Pro
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 font-bold uppercase text-[9px] bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-300 dark:border-zinc-700">
                            Free
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-zinc-500">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td className="p-3">
                        {editingUserId === u.id ? (
                          <div className="flex gap-2 items-center">
                            <Input 
                              type="number"
                              className="w-16 h-7 text-xs px-2"
                              value={newLimitVal}
                              onChange={(e) => setNewLimitVal(parseInt(e.target.value) || 0)}
                            />
                            <Button 
                              size="xs"
                              disabled={updateRateLimitMutation.isPending}
                              onClick={() => updateRateLimitMutation.mutate({
                                userId: u.id,
                                request_count: newLimitVal
                              })}
                            >
                              Save
                            </Button>
                            <Button size="xs" variant="ghost" onClick={() => setEditingUserId(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <span className="font-mono text-zinc-700">
                            {u.request_count} builds
                          </span>
                        )}
                        {u.reset_at && (
                          <p className="mt-1 text-[10px] font-semibold text-zinc-400">
                            Resets {new Date(u.reset_at).toLocaleString()}
                          </p>
                        )}
                      </td>
                      <td className="p-3 text-zinc-600">
                        <p className="font-mono">Daily {u.daily_cap ?? 5}</p>
                        <p className="font-mono">Monthly {u.monthly_count ?? 0}/{u.monthly_cap ?? 150}</p>
                      </td>
                      <td className="p-3 text-right space-x-1.5">
                        <Button
                          size="xs"
                          variant={u.is_pro ? "outline" : "default"}
                          disabled={toggleUserTierMutation.isPending || u.is_admin}
                          onClick={() => toggleUserTierMutation.mutate({ userId: u.id, is_pro: !u.is_pro })}
                          title={u.is_admin ? "Admins are automatically Pro" : undefined}
                        >
                          {u.is_pro ? "Demote Free" : "Make Pro"}
                        </Button>
                        <Button 
                          size="xs" 
                          variant="outline"
                          onClick={() => {
                            setEditingUserId(u.id)
                            setNewLimitVal(u.request_count)
                          }}
                        >
                          Set Used Count
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => updateRateLimitMutation.mutate({ userId: u.id, request_count: 0 })}
                        >
                          Reset
                        </Button>
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => {
                            const daily = Number(prompt("Daily cap", String(u.daily_cap ?? 5)))
                            const monthly = Number(prompt("Monthly cap", String(u.monthly_cap ?? 150)))
                            if (!Number.isNaN(daily) && !Number.isNaN(monthly)) {
                              updateCreditsMutation.mutate({ userId: u.id, daily_cap: daily, monthly_cap: monthly, admin_note: u.admin_note })
                            }
                          }}
                        >
                          Caps
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── 8. FEEDBACK & SUPPORT TAB ── */}
      {activeTab === "feedback" && (
        <div className="space-y-6 pixel-enter">
          {/* Metrics Header */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="panel-strong p-4 bg-white dark:bg-zinc-900 border-2 border-black">
              <p className="text-[10px] font-black uppercase tracking-wider text-zinc-400">Total Reports</p>
              <p className="text-2xl font-black mt-1">{feedbackAnalytics?.total_reports ?? 0}</p>
            </div>
            <div className="panel-strong p-4 bg-white dark:bg-zinc-900 border-2 border-black">
              <p className="text-[10px] font-black uppercase tracking-wider text-zinc-400">Open Tickets</p>
              <p className="text-2xl font-black mt-1 text-[#ff4e26]">{feedbackAnalytics?.open_count ?? 0}</p>
            </div>
            <div className="panel-strong p-4 bg-white dark:bg-zinc-900 border-2 border-black">
              <p className="text-[10px] font-black uppercase tracking-wider text-zinc-400">Avg Star Rating</p>
              <p className="text-2xl font-black mt-1 text-amber-500 flex items-center gap-1">
                ⭐ {feedbackAnalytics?.avg_rating ?? "N/A"}
              </p>
            </div>
            <div className="panel-strong p-4 bg-white dark:bg-zinc-900 border-2 border-black">
              <p className="text-[10px] font-black uppercase tracking-wider text-zinc-400">Total Reviews</p>
              <p className="text-2xl font-black mt-1">{feedbackAnalytics?.total_ratings ?? 0}</p>
            </div>
          </div>

          {/* Sub-tab Toggle & Controls */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-700 pb-3">
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={feedbackSubTab === "reports" ? "default" : "outline"}
                onClick={() => setFeedbackSubTab("reports")}
              >
                <MessageSquare size={14} className="mr-1.5" /> Support Reports ({supportReports.length})
              </Button>
              <Button
                size="sm"
                variant={feedbackSubTab === "ratings" ? "default" : "outline"}
                onClick={() => setFeedbackSubTab("ratings")}
              >
                <Star size={14} className="mr-1.5" /> Ratings & Reviews ({feedbackRatings.length})
              </Button>
            </div>

            {feedbackSubTab === "reports" && (
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Input
                  placeholder="Search reports..."
                  className="h-8 text-xs w-44"
                  value={reportSearch}
                  onChange={(e) => setReportSearch(e.target.value)}
                />
                <select
                  value={reportStatusFilter}
                  onChange={(e) => setReportStatusFilter(e.target.value)}
                  className="h-8 text-xs border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 font-mono"
                >
                  <option value="">All Statuses</option>
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                </select>
                <select
                  value={reportCategoryFilter}
                  onChange={(e) => setReportCategoryFilter(e.target.value)}
                  className="h-8 text-xs border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 font-mono"
                >
                  <option value="">All Categories</option>
                  <option value="bug">Bug</option>
                  <option value="billing">Billing</option>
                  <option value="feedback">Feedback</option>
                  <option value="other">Other</option>
                </select>
              </div>
            )}
          </div>

          {/* Sub-tab 1: Reports Table */}
          {feedbackSubTab === "reports" && (
            <div className="panel-strong bg-white dark:bg-zinc-900 border-2 border-black overflow-hidden">
              {loadingReports ? (
                <div className="p-8 text-center text-xs font-mono text-zinc-500">Loading reports...</div>
              ) : supportReports.length === 0 ? (
                <div className="p-8 text-center text-xs font-mono text-zinc-500">No support reports found.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-sans">
                    <thead className="bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700 font-extrabold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                      <tr>
                        <th className="p-3">Created</th>
                        <th className="p-3">Sender</th>
                        <th className="p-3">Category</th>
                        <th className="p-3">Summary / Message</th>
                        <th className="p-3 text-center">Files</th>
                        <th className="p-3">Status</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                      {supportReports.map((report) => (
                        <tr key={report.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                          <td className="p-3 font-mono text-zinc-500 text-[11px] whitespace-nowrap">
                            {new Date(report.created_at).toLocaleString()}
                          </td>
                          <td className="p-3">
                            <p className="font-bold text-zinc-900 dark:text-zinc-100">{report.user_email || "Anonymous"}</p>
                            {report.user_name && <p className="text-[10px] text-zinc-500">{report.user_name}</p>}
                          </td>
                          <td className="p-3">
                            <span className="inline-block px-2 py-0.5 border border-black dark:border-zinc-600 text-[10px] font-black uppercase bg-zinc-100 dark:bg-zinc-800">
                              {report.category || "other"}
                            </span>
                          </td>
                          <td className="p-3 max-w-xs">
                            <p className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                              {report.auto_summary || report.message}
                            </p>
                            {report.sentiment_score !== undefined && (
                              <span className={`text-[10px] font-mono font-bold ${report.sentiment_score < -0.2 ? "text-red-500" : report.sentiment_score > 0.2 ? "text-emerald-500" : "text-zinc-400"}`}>
                                Sentiment: {report.sentiment_score}
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-center font-mono font-bold">
                            {report.attachment_count > 0 ? (
                              <span className="inline-flex items-center gap-1 text-[#ff4e26]">
                                <ImageIcon size={12} /> {report.attachment_count}
                              </span>
                            ) : (
                              <span className="text-zinc-400">-</span>
                            )}
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 text-[10px] font-extrabold uppercase border ${
                              report.status === "open"
                                ? "bg-red-50 text-red-600 border-red-300"
                                : report.status === "in_progress"
                                ? "bg-amber-50 text-amber-600 border-amber-300"
                                : "bg-emerald-50 text-emerald-600 border-emerald-300"
                            }`}>
                              {report.status}
                            </span>
                          </td>
                          <td className="p-3 text-right space-x-1.5">
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => {
                                setSelectedReportId(report.id)
                                setEditingAdminNote(report.admin_note || "")
                                setEditingReportStatus(report.status)
                              }}
                            >
                              View Details
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              className="text-red-500 hover:text-red-700"
                              onClick={() => {
                                if (confirm("Delete this support report and its files?")) {
                                  deleteReportMutation.mutate(report.id)
                                }
                              }}
                            >
                              Delete
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Sub-tab 2: Ratings List */}
          {feedbackSubTab === "ratings" && (
            <div className="panel-strong bg-white dark:bg-zinc-900 border-2 border-black overflow-hidden">
              {loadingRatings ? (
                <div className="p-8 text-center text-xs font-mono text-zinc-500">Loading ratings...</div>
              ) : feedbackRatings.length === 0 ? (
                <div className="p-8 text-center text-xs font-mono text-zinc-500">No ratings submitted yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-sans">
                    <thead className="bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700 font-extrabold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                      <tr>
                        <th className="p-3">Date</th>
                        <th className="p-3">User</th>
                        <th className="p-3">Rating</th>
                        <th className="p-3">Comment</th>
                        <th className="p-3">Target Role</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                      {feedbackRatings.map((rating) => (
                        <tr key={rating.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                          <td className="p-3 font-mono text-zinc-500 text-[11px] whitespace-nowrap">
                            {new Date(rating.created_at).toLocaleString()}
                          </td>
                          <td className="p-3 font-bold text-zinc-900 dark:text-zinc-100">
                            {rating.user_email || "User"}
                          </td>
                          <td className="p-3 whitespace-nowrap">
                            <div className="flex items-center gap-0.5 text-amber-500">
                              {[1, 2, 3, 4, 5].map((star) => (
                                <Star
                                  key={star}
                                  size={14}
                                  className={star <= rating.star_rating ? "fill-amber-400 text-amber-500" : "text-zinc-300 dark:text-zinc-700"}
                                />
                              ))}
                            </div>
                          </td>
                          <td className="p-3 text-zinc-700 dark:text-zinc-300 italic max-w-sm">
                            {rating.comment || <span className="text-zinc-400 not-italic">No comment left</span>}
                          </td>
                          <td className="p-3 font-mono text-zinc-500 text-[11px]">
                            {rating.generation_job_title || "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Report Detail Modal */}
          {selectedReportId && selectedReportDetail && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
              <div className="relative w-full max-w-2xl border-3 border-black dark:border-zinc-600 bg-white dark:bg-zinc-900 p-6 shadow-[8px_8px_0px_#000] max-h-[90vh] overflow-y-auto space-y-5">
                <button
                  onClick={() => setSelectedReportId(null)}
                  className="absolute top-4 right-4 text-zinc-500 hover:text-black dark:hover:text-white"
                >
                  <X size={20} />
                </button>

                <div className="space-y-1">
                  <span className="px-2 py-0.5 bg-[#ff4e26] text-white text-[10px] font-black uppercase border border-black">
                    {selectedReportDetail.category || "Report"}
                  </span>
                  <h3 className="text-xl font-extrabold uppercase">Support Ticket Details</h3>
                  <p className="text-xs font-mono text-zinc-500">
                    ID: {selectedReportDetail.id} · From: {selectedReportDetail.user_email || "Anonymous"}
                  </p>
                </div>

                {/* AI Executive Summary if present */}
                {selectedReportDetail.auto_summary && (
                  <div className="p-3 bg-zinc-100 dark:bg-zinc-800 border-2 border-black space-y-1">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#ff4e26]">AI Executive Summary</p>
                    <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200">{selectedReportDetail.auto_summary}</p>
                  </div>
                )}

                {/* Full Message */}
                <div className="space-y-1">
                  <Label className="text-xs font-extrabold uppercase text-zinc-500">Full Message</Label>
                  <div className="p-4 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-300 dark:border-zinc-700 font-sans text-sm text-zinc-900 dark:text-zinc-100 whitespace-pre-wrap">
                    {selectedReportDetail.message}
                  </div>
                </div>

                {/* Attachments Section */}
                {selectedReportDetail.attachments && selectedReportDetail.attachments.length > 0 && (
                  <div className="space-y-3">
                    <Label className="text-xs font-extrabold uppercase text-zinc-500">Attached Files</Label>
                    <div className="space-y-3">
                      {selectedReportDetail.attachments.map((att) => (
                        <div key={att.id} className="p-3 border-2 border-black bg-zinc-50 dark:bg-zinc-800 space-y-2">
                          <div className="flex items-center justify-between text-xs font-mono">
                            <span className="font-bold uppercase text-[#ff4e26]">{att.attachment_type}</span>
                            <span className="text-zinc-500">{att.filename || "file"}</span>
                          </div>

                          {att.attachment_type === "screenshot" && att.presigned_url && (
                            <div className="border border-black overflow-hidden max-h-60 bg-black">
                              {/* eslint-disable-next-html-element-suppression */}
                              <img src={att.presigned_url} alt="Screenshot" className="w-full object-contain max-h-60" />
                            </div>
                          )}

                          {att.attachment_type === "voice_recording" && att.presigned_url && (
                            <div className="space-y-2">
                              <audio controls src={att.presigned_url} className="w-full h-8" />
                              {att.transcription && (
                                <div className="p-2 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-xs font-sans text-zinc-800 dark:text-zinc-200">
                                  <span className="font-extrabold uppercase text-[10px] text-emerald-600 block">Voice Transcription:</span>
                                  {att.transcription}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Admin Status & Notes Editor */}
                <div className="space-y-3 pt-3 border-t border-zinc-200 dark:border-zinc-700">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs font-extrabold uppercase">Ticket Status</Label>
                      <select
                        value={editingReportStatus}
                        onChange={(e) => setEditingReportStatus(e.target.value)}
                        className="w-full p-2 text-xs border-2 border-black bg-white dark:bg-zinc-800 font-extrabold uppercase"
                      >
                        <option value="open">Open</option>
                        <option value="in_progress">In Progress</option>
                        <option value="resolved">Resolved</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-extrabold uppercase">Admin Response Note</Label>
                    <Textarea
                      rows={3}
                      value={editingAdminNote}
                      onChange={(e) => setEditingAdminNote(e.target.value)}
                      placeholder="Add an internal note or message sent to the user on resolution..."
                      className="border-2 border-black font-sans text-xs"
                    />
                  </div>

                  <div className="flex gap-2 justify-end pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedReportId(null)}
                      className="border-2 border-black font-bold uppercase text-xs"
                    >
                      Close
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        updateReportStatusMutation.mutate({
                          id: selectedReportDetail.id,
                          status: editingReportStatus,
                          admin_note: editingAdminNote.trim() || undefined,
                        })
                      }}
                      className="bg-[#ff4e26] hover:bg-[#e03d16] text-white border-2 border-black font-extrabold uppercase text-xs shadow-[2px_2px_0px_#000]"
                    >
                      Save Status & Respond
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
