"use client"

import { useRef, useState, useEffect, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { AdminSidebar } from "@/components/admin/AdminSidebar"
import { AdminHeader } from "@/components/admin/AdminHeader"
import { AdminIssueInbox } from "@/components/admin/AdminIssueInbox"
import { AdminTabId } from "@/components/admin/types"
import { LlmSettingsPanel } from "@/components/admin/llm/LlmSettingsPanel"
import type { LlmStatusSummary } from "@/components/admin/llm/types"
import { 
  RefreshCw, 
  Trash2, 
  FileText, 
  Terminal, 
  Lock, 
  ArrowLeft,
  Play,
  Download,
  MoreHorizontal,
  MessageSquare,
  Star,
  X,
  Cpu,
  Activity,
  Timer,
  ArrowUpDown,
  Layers,
} from "lucide-react"
type AnalyticsData = {
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
  duration_seconds?: number | null
  is_guest: boolean
  error_message?: string
  intermediate_resume_count: number
}

type GenerationNodeDetail = {
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

type ModelBenchmarkItem = {
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

type TemplateBenchmarkItem = {
  template_id: string
  total_runs: number
  avg_duration_seconds: number
}

type NodeModelBenchmarkItem = {
  node_name: string
  provider: string
  model: string
  calls: number
  avg_latency_ms: number
  total_tokens: number
  errors: number
  fallbacks: number
}

type SlowestRunItem = {
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

type TimingByModelResponse = {
  models_benchmark: ModelBenchmarkItem[]
  templates_benchmark: TemplateBenchmarkItem[]
  nodes_by_model: NodeModelBenchmarkItem[]
  slowest_runs: SlowestRunItem[]
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

function formatDuration(seconds?: number | null): string {
  if (seconds === null || seconds === undefined) return "--"
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const mins = Math.floor(seconds / 60)
  const remSecs = Math.round(seconds % 60)
  return `${mins}m ${remSecs < 10 ? "0" : ""}${remSecs}s`
}

function LiveElapsedTimer({ startTime }: { startTime: string }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const start = new Date(startTime).getTime()
    const update = () => {
      const now = Date.now()
      setElapsed(Math.max(0, Math.round((now - start) / 1000)))
    }
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [startTime])

  return (
    <span className="inline-flex items-center gap-1 font-mono font-bold text-amber-600 dark:text-amber-400">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 animate-ping" />
      {formatDuration(elapsed)}
    </span>
  )
}

function TimingWaterfallModal({
  generation,
  onClose,
}: {
  generation: GenerationItem
  onClose: () => void
}) {
  const { data: metrics = [], isLoading } = useQuery<GenerationNodeDetail[]>({
    queryKey: ["admin", "generation-metrics", generation.id],
    queryFn: () => fetchJson<GenerationNodeDetail[]>(`/api/backend/admin/generations/${generation.id}/metrics`),
  })

  const totalNodeLatencyMs = metrics.reduce((acc, m) => acc + (m.latency_ms || 0), 0)
  const totalTokens = metrics.reduce((acc, m) => acc + (m.total_tokens || 0), 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 shadow-2xl space-y-4">
        <div className="flex justify-between items-start border-b border-zinc-200 dark:border-zinc-800 pb-3">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-[#ff4e26]">Latency Telemetry</p>
            <h3 className="text-base font-extrabold uppercase text-black dark:text-white truncate">
              {generation.job_title || "Generation"} Timing Breakdown
            </h3>
            <p className="text-xs font-mono text-zinc-500 mt-0.5">
              ID: {generation.id} &bull; Pipeline: {generation.duration_seconds ? formatDuration(generation.duration_seconds) : `${(totalNodeLatencyMs / 1000).toFixed(1)}s`} &bull; {totalTokens.toLocaleString()} tokens
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-zinc-400 hover:text-black dark:hover:text-white cursor-pointer">
            <X size={18} />
          </button>
        </div>

        {isLoading ? (
          <div className="soft-skeleton h-40" />
        ) : metrics.length === 0 ? (
          <p className="text-xs text-zinc-500 italic text-center py-8">No node metrics recorded for this run.</p>
        ) : (
          <div className="space-y-4">
            {/* Visual Timeline Bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px] font-mono text-zinc-500 font-bold uppercase">
                <span>Execution Waterfall</span>
                <span>{metrics.length} nodes executed</span>
              </div>
              <div className="h-3.5 w-full bg-zinc-100 dark:bg-zinc-800 flex overflow-hidden border border-zinc-200 dark:border-zinc-700 rounded-none">
                {metrics.map((m, idx) => {
                  const pct = totalNodeLatencyMs > 0 ? ((m.latency_ms || 0) / totalNodeLatencyMs) * 100 : 0
                  const colors = [
                    "bg-[#ff4e26]",
                    "bg-amber-500",
                    "bg-emerald-500",
                    "bg-cyan-500",
                    "bg-indigo-500",
                    "bg-purple-500",
                    "bg-pink-500",
                  ]
                  const color = colors[idx % colors.length]
                  return (
                    <div
                      key={m.id}
                      className={`h-full ${color}`}
                      style={{ width: `${Math.max(2, pct)}%` }}
                      title={`${m.node_name}: ${((m.latency_ms || 0) / 1000).toFixed(2)}s (${Math.round(pct)}%)`}
                    />
                  )
                })}
              </div>
            </div>

            {/* Per-Node List */}
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 text-xs">
              {metrics.map((m) => {
                const sec = ((m.latency_ms || 0) / 1000).toFixed(2)
                const pct = totalNodeLatencyMs > 0 ? Math.round(((m.latency_ms || 0) / totalNodeLatencyMs) * 100) : 0
                return (
                  <div key={m.id} className="p-2.5 flex items-center justify-between gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <div className="min-w-0">
                      <p className="font-extrabold uppercase text-black dark:text-white flex items-center gap-2">
                        <span>{m.node_name}</span>
                        {m.fallback_used && (
                          <span className="text-[9px] bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 px-1 py-0.5 font-mono">
                            Fallback
                          </span>
                        )}
                        {m.status === "error" && (
                          <span className="text-[9px] bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 px-1 py-0.5 font-mono">
                            Error
                          </span>
                        )}
                      </p>
                      <p className="text-[10px] text-zinc-500 font-mono mt-0.5 truncate">
                        {m.provider} &bull; {m.model || "default"} &bull; {m.total_tokens ? `${m.total_tokens} tokens` : "0 tokens"}
                      </p>
                      {m.error_message && (
                        <p className="text-[10px] text-red-600 font-semibold mt-0.5 truncate">{m.error_message}</p>
                      )}
                    </div>
                    <div className="text-right font-mono shrink-0">
                      <p className="font-extrabold text-black dark:text-white">{sec}s</p>
                      <p className="text-[10px] text-zinc-400">{pct}%</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function AdminClient({ initialTab = "analytics" }: { initialTab?: AdminTabId }) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<AdminTabId>(initialTab)
  const [genSortField, setGenSortField] = useState<"job_title" | "model_used" | "status" | "duration_seconds" | "created_at">("created_at")
  const [genSortOrder, setGenSortOrder] = useState<"asc" | "desc">("desc")

  const toggleGenSort = (field: "job_title" | "model_used" | "status" | "duration_seconds" | "created_at") => {
    if (genSortField === field) {
      setGenSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))
    } else {
      setGenSortField(field)
      setGenSortOrder(field === "job_title" || field === "model_used" || field === "status" ? "asc" : "desc")
    }
  }

  const handleManualRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["admin"] })
  }
  const [generationSearch, setGenerationSearch] = useState("")
  const [timingSearch, setTimingSearch] = useState("")
  const [generationStatus, setGenerationStatus] = useState("")
  const [generationUserType, setGenerationUserType] = useState("")
  const [selectedTimingGen, setSelectedTimingGen] = useState<GenerationItem | null>(null)
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [newLimitVal, setNewLimitVal] = useState(5)
  const [userSearch, setUserSearch] = useState("")
  const [storagePrefix, setStoragePrefix] = useState("")
  const [playgroundVariables, setPlaygroundVariables] = useState("{}")
  const [playgroundResult, setPlaygroundResult] = useState("")
  const [playgroundError, setPlaygroundError] = useState<string | null>(null)
  const [promptSearch, setPromptSearch] = useState("")
  const [outputCopied, setOutputCopied] = useState(false)
  const [bulkCases, setBulkCases] = useState("[]")
  const [templateId, setTemplateId] = useState("personal-classic")
  const [templateContext, setTemplateContext] = useState("{}")
  const [templateHtml, setTemplateHtml] = useState("")
  // Feedback Tab States
  const [feedbackSubTab, setFeedbackSubTab] = useState<"reports" | "ratings">("reports")
  // States for Prompt editor
  const [selectedPrompt, setSelectedPrompt] = useState<PromptConfig | null>(null)
  const [systemPromptVal, setSystemPromptVal] = useState("")
  const [userPromptVal, setUserPromptVal] = useState("")

  // States for log view
  const [viewingLogsGenId, setViewingLogsGenId] = useState<string | null>(null)
  const streamRef = useRef<EventSource | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [liveLogs, setLiveLogs] = useState<LogItem[]>([])

  // Timing by Model Query
  const { data: timingData, isLoading: loadingTiming, refetch: refetchTiming } = useQuery<TimingByModelResponse>({
    queryKey: ["admin", "timing-by-model"],
    queryFn: () => fetchJson<TimingByModelResponse>("/api/backend/admin/metrics/timing-by-model"),
  })

  // 2. Fetch Generations
  const { data: analytics, error: analyticsErr, isLoading: loadingAnalytics } = useQuery<AnalyticsData>({
    queryKey: ["admin", "analytics"],
    queryFn: () => fetchJson<AnalyticsData>("/api/backend/admin/analytics"),
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

  const sortedGenerations = useMemo(() => {
    return [...generations].sort((a, b) => {
      if (genSortField === "created_at") {
        const timeA = new Date(a.created_at).getTime()
        const timeB = new Date(b.created_at).getTime()
        return genSortOrder === "asc" ? timeA - timeB : timeB - timeA
      }
      if (genSortField === "duration_seconds") {
        const durA = a.duration_seconds ?? (genSortOrder === "asc" ? 999999 : -1)
        const durB = b.duration_seconds ?? (genSortOrder === "asc" ? 999999 : -1)
        return genSortOrder === "asc" ? durA - durB : durB - durA
      }
      if (genSortField === "job_title") {
        const strA = (a.job_title || a.email || "").toLowerCase()
        const strB = (b.job_title || b.email || "").toLowerCase()
        return genSortOrder === "asc" ? strA.localeCompare(strB) : strB.localeCompare(strA)
      }
      if (genSortField === "model_used") {
        const strA = (a.model_used || "").toLowerCase()
        const strB = (b.model_used || "").toLowerCase()
        return genSortOrder === "asc" ? strA.localeCompare(strB) : strB.localeCompare(strA)
      }
      if (genSortField === "status") {
        const strA = (a.status || "").toLowerCase()
        const strB = (b.status || "").toLowerCase()
        return genSortOrder === "asc" ? strA.localeCompare(strB) : strB.localeCompare(strA)
      }
      return 0
    })
  }, [generations, genSortField, genSortOrder])
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
    staleTime: 30000,
  })

  const { data: feedbackRatings = [], isLoading: loadingRatings, isError: ratingsError } = useQuery<FeedbackRatingItem[]>({
    queryKey: ["admin", "feedback", "ratings"],
    queryFn: () => fetchJson<FeedbackRatingItem[]>("/api/backend/admin/feedback/ratings?limit=50"),
    enabled: activeTab === "feedback" && feedbackSubTab === "ratings",
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
      let variables: Record<string, unknown>
      try {
        variables = JSON.parse(playgroundVariables)
      } catch {
        throw new Error("Variables are not valid JSON.")
      }
      const res = await fetch("/api/backend/admin/prompts/playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt_name: selectedPrompt.name,
          system_prompt: systemPromptVal,
          user_prompt: userPromptVal,
          variables,
        }),
      })
      if (!res.ok) throw new Error("Prompt playground failed")
      return res.json()
    },
    onSuccess: (data) => {
      setPlaygroundError(null)
      setPlaygroundResult(data.output || data.error_message || "No output")
      queryClient.invalidateQueries({ queryKey: ["admin", "prompt-test-runs"] })
    },
    onError: (err) => {
      setPlaygroundResult("")
      setPlaygroundError(err instanceof Error ? err.message : "Prompt playground failed")
    },
  })

  const runBulkMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPrompt) throw new Error("Select a prompt first")
      let cases: unknown
      try {
        cases = JSON.parse(bulkCases)
      } catch {
        throw new Error("Bulk cases are not valid JSON.")
      }
      const res = await fetch("/api/backend/admin/prompts/bulk-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt_name: selectedPrompt.name,
          system_prompt: systemPromptVal,
          user_prompt: userPromptVal,
          cases,
        }),
      })
      if (!res.ok) throw new Error("Bulk test failed")
      return res.json()
    },
    onSuccess: (data) => {
      setPlaygroundError(null)
      setPlaygroundResult(JSON.stringify(data.results, null, 2))
      queryClient.invalidateQueries({ queryKey: ["admin", "prompt-test-runs"] })
    },
    onError: (err) => {
      setPlaygroundResult("")
      setPlaygroundError(err instanceof Error ? err.message : "Bulk test failed")
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

  // Prompt library filter + edit state
  const filteredPrompts = useMemo(() => {
    const needle = promptSearch.trim().toLowerCase()
    if (!needle) return prompts
    return prompts.filter((p) => p.name.toLowerCase().includes(needle))
  }, [prompts, promptSearch])

  const isPromptDirty = useMemo(() => {
    if (!selectedPrompt) return false
    return (
      systemPromptVal !== selectedPrompt.system_prompt ||
      userPromptVal !== (selectedPrompt.user_prompt || "")
    )
  }, [selectedPrompt, systemPromptVal, userPromptVal])

  // Bulk-case count is best-effort: invalid JSON simply reads as 0
  const bulkCaseCount = useMemo(() => {
    try {
      const parsed = JSON.parse(bulkCases)
      return Array.isArray(parsed) ? parsed.length : 0
    } catch {
      return 0
    }
  }, [bulkCases])

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

  const discardPromptEdits = () => {
    if (!selectedPrompt) return
    setSystemPromptVal(selectedPrompt.system_prompt)
    setUserPromptVal(selectedPrompt.user_prompt || "")
  }

  const formatPlaygroundVariables = () => {
    try {
      setPlaygroundVariables(JSON.stringify(JSON.parse(playgroundVariables), null, 2))
      setPlaygroundError(null)
    } catch {
      setPlaygroundError("Variables are not valid JSON, so they cannot be formatted.")
    }
  }

  const copyPlaygroundOutput = async () => {
    if (!playgroundResult) return
    try {
      await navigator.clipboard.writeText(playgroundResult)
      setOutputCopied(true)
      window.setTimeout(() => setOutputCopied(false), 1600)
    } catch {
      setOutputCopied(false)
    }
  }

  const showRunOutput = (run: PromptTestRun) => {
    if (run.error_message) {
      setPlaygroundResult("")
      setPlaygroundError(run.error_message)
      return
    }
    setPlaygroundError(null)
    setPlaygroundResult(run.output || "No output was recorded for this run.")
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
    <div className="flex flex-col md:flex-row flex-1 w-full min-h-[calc(100dvh-49px)]">
      {/* Clean Left Sidebar */}
      <AdminSidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        unresolvedReportsCount={feedbackAnalytics?.open_count ?? 0}
      />

      {/* Main Workspace Stage */}
      <div className="flex-1 md:pl-56 min-w-0 bg-[#fbfbf3] dark:bg-zinc-900">
        <div className="px-3 py-4 sm:p-6 mx-auto w-full max-w-6xl">
          <AdminHeader
            activeTab={activeTab}
            isFetching={loadingAnalytics || loadingTiming || loadingGenerations || loadingUsers}
            onManualRefresh={handleManualRefresh}
          />

      {/* ANALYTICS TAB */}
      {activeTab === "analytics" && (
        <div className="space-y-6 pixel-enter">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">All-time totals. Generation timing includes completed builds only. Failure rate is failed builds divided by all builds.</p>
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
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">Avg Latency (P50/P90)</p>
                  <p className="text-3xl font-black text-black dark:text-white mt-1">{analytics.average_generation_latency_seconds}s</p>
                  <p className="mt-1 text-[10px] font-mono font-bold uppercase text-zinc-500">
                    P50: {analytics.p50_latency_seconds ?? "--"}s &bull; P90: {analytics.p90_latency_seconds ?? "--"}s
                  </p>
                </div>
                <div className="panel-strong p-4">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">Generation Failure Rate</p>
                  <p className="text-3xl font-black mt-1 text-red-600">{analytics.failure_rate_percent}%</p>
                </div>
              </div>

              {/* Advanced info section */}
              <div className="grid gap-6 md:grid-cols-2">
                {/* Generation Queue Breakdown */}
                <div className="panel-strong p-5 space-y-4">
                  <h3 className="text-sm font-bold uppercase tracking-wide border-b dark:border-zinc-700 pb-2 text-zinc-800 dark:text-zinc-200">Generations by Status</h3>
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

                {/* LLM routing status */}
                <div className="panel-strong p-5 space-y-4">
                  <div className="flex items-center justify-between gap-2 border-b dark:border-zinc-700 pb-2">
                    <h3 className="text-sm font-bold uppercase tracking-wide text-zinc-800 dark:text-zinc-200">LLM Routing</h3>
                    {analytics.llm_status ? (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase",
                          analytics.llm_status.ready
                            ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                            : "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300"
                        )}
                      >
                        <span className={cn("h-1.5 w-1.5 rounded-full", analytics.llm_status.ready ? "bg-emerald-500" : "bg-red-500")} />
                        {analytics.llm_status.ready ? "Ready" : "Not configured"}
                      </span>
                    ) : (
                      <span className="font-mono text-[10px] text-zinc-400">status unavailable</span>
                    )}
                  </div>
                  <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {([
                      ["Resume generation", analytics.llm_status?.default_primary],
                      ["Pro", analytics.llm_status?.pro_primary],
                    ] as const).map(([label, primary]) => (
                      <div key={label} className="min-w-0 border border-zinc-200 dark:border-zinc-700 p-3 bg-zinc-50 dark:bg-zinc-800">
                        <dt className="text-[10px] font-bold text-zinc-600 dark:text-zinc-400 uppercase">{label}</dt>
                        {primary ? (
                          <dd className="mt-1 min-w-0">
                            <p className="truncate text-sm font-black text-black dark:text-white" title={primary.endpoint_name}>{primary.endpoint_name}</p>
                            <p className="truncate font-mono text-[11px] text-[#ff4e26]" title={primary.model}>{primary.model}</p>
                          </dd>
                        ) : (
                          <dd className="mt-1 text-sm font-bold text-zinc-400">Not routed</dd>
                        )}
                      </div>
                    ))}
                  </dl>
                  <div className="flex justify-between items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400 font-semibold">
                    <span className="font-mono">
                      {analytics.llm_status
                        ? `${analytics.llm_status.endpoints_enabled}/${analytics.llm_status.endpoints_total} endpoints enabled`
                        : "—"}
                    </span>
                    <Button size="xs" variant="outline" onClick={() => setActiveTab("models")}>
                      Manage endpoints &rarr;
                    </Button>
                  </div>
                </div>
              </div>
              {/* Duration Distribution Histogram Breakdown */}
              {analytics.duration_buckets && (
                <div className="panel-strong p-5 space-y-3">
                  <div className="flex justify-between items-center border-b dark:border-zinc-700 pb-2">
                    <h3 className="text-sm font-bold uppercase tracking-wide text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
                      <Timer size={15} className="text-[#ff4e26]" /> Generation Latency Distribution
                    </h3>
                    <span className="text-[10px] font-mono text-zinc-500">P99: {analytics.p99_latency_seconds ?? "--"}s</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-5 text-center text-xs">
                    {[
                      { label: "< 30s", count: analytics.duration_buckets.under_30s, color: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/60" },
                      { label: "30s - 60s", count: analytics.duration_buckets["30s_to_60s"], color: "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-900/60" },
                      { label: "1m - 2m", count: analytics.duration_buckets["1m_to_2m"], color: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/60" },
                      { label: "2m - 5m", count: analytics.duration_buckets["2m_to_5m"], color: "text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-900/60" },
                      { label: "> 5m", count: analytics.duration_buckets.over_5m, color: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900/60" },
                    ].map((b) => (
                      <div key={b.label} className={`p-3 border ${b.color}`}>
                        <p className="text-[10px] font-bold uppercase tracking-wider">{b.label}</p>
                        <p className="text-xl font-black mt-1">{b.count}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p>No data loaded.</p>
          )}
        </div>
      )}

      {/* LLM ENDPOINTS & ROUTING TAB */}
      {activeTab === "models" && <LlmSettingsPanel />}

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
                        <th
                          className="p-3 cursor-pointer select-none hover:text-black dark:hover:text-white transition-colors"
                          onClick={() => toggleGenSort("job_title")}
                        >
                          <div className="flex items-center gap-1">
                            <span>Job & User</span>
                            {genSortField === "job_title" ? (
                              <span className="text-[#ff4e26] font-mono font-bold text-[10px]">{genSortOrder === "asc" ? "▲" : "▼"}</span>
                            ) : (
                              <ArrowUpDown size={11} className="text-zinc-400 opacity-60" />
                            )}
                          </div>
                        </th>
                        <th
                          className="p-3 cursor-pointer select-none hover:text-black dark:hover:text-white transition-colors"
                          onClick={() => toggleGenSort("model_used")}
                        >
                          <div className="flex items-center gap-1">
                            <span>Model</span>
                            {genSortField === "model_used" ? (
                              <span className="text-[#ff4e26] font-mono font-bold text-[10px]">{genSortOrder === "asc" ? "▲" : "▼"}</span>
                            ) : (
                              <ArrowUpDown size={11} className="text-zinc-400 opacity-60" />
                            )}
                          </div>
                        </th>
                        <th
                          className="p-3 cursor-pointer select-none hover:text-black dark:hover:text-white transition-colors"
                          onClick={() => toggleGenSort("status")}
                        >
                          <div className="flex items-center gap-1">
                            <span>Status</span>
                            {genSortField === "status" ? (
                              <span className="text-[#ff4e26] font-mono font-bold text-[10px]">{genSortOrder === "asc" ? "▲" : "▼"}</span>
                            ) : (
                              <ArrowUpDown size={11} className="text-zinc-400 opacity-60" />
                            )}
                          </div>
                        </th>
                        <th
                          className="p-3 cursor-pointer select-none hover:text-black dark:hover:text-white transition-colors"
                          onClick={() => toggleGenSort("duration_seconds")}
                        >
                          <div className="flex items-center gap-1">
                            <span>Duration</span>
                            {genSortField === "duration_seconds" ? (
                              <span className="text-[#ff4e26] font-mono font-bold text-[10px]">{genSortOrder === "asc" ? "▲" : "▼"}</span>
                            ) : (
                              <ArrowUpDown size={11} className="text-zinc-400 opacity-60" />
                            )}
                          </div>
                        </th>
                        <th
                          className="p-3 cursor-pointer select-none hover:text-black dark:hover:text-white transition-colors"
                          onClick={() => toggleGenSort("created_at")}
                        >
                          <div className="flex items-center gap-1">
                            <span>Created</span>
                            {genSortField === "created_at" ? (
                              <span className="text-[#ff4e26] font-mono font-bold text-[10px]">{genSortOrder === "asc" ? "▲" : "▼"}</span>
                            ) : (
                              <ArrowUpDown size={11} className="text-zinc-400 opacity-60" />
                            )}
                          </div>
                        </th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700 font-medium">
                      {sortedGenerations.map((gen) => {

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
                            <td className="p-3 font-mono text-[11px]">
                              {gen.status === "in_progress" || gen.status === "pending" ? (
                                <LiveElapsedTimer startTime={gen.created_at} />
                              ) : gen.status === "completed" ? (
                                <span className="font-extrabold text-green-700 dark:text-green-400">
                                  {formatDuration(gen.duration_seconds)}
                                </span>
                              ) : gen.status === "failed" ? (
                                <span className="font-bold text-red-600 dark:text-red-400">
                                  {formatDuration(gen.duration_seconds)}
                                </span>
                              ) : (
                                <span className="text-zinc-400">{formatDuration(gen.duration_seconds)}</span>
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
                                    className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
                                    onClick={() => setSelectedTimingGen(gen)}
                                  >
                                    <Timer size={12} className="text-[#ff4e26]" /> Timing Waterfall
                                  </button>
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
                                    <Download size={12} /> Final résumé
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

      {/* PIPELINE TIMING & MODEL BENCHMARK TAB */}
      {activeTab === "timing" && (
        <div className="space-y-6 pixel-enter">
          {/* Header */}
          <div className="flex flex-wrap justify-between items-center gap-3 border-b dark:border-zinc-700 pb-3">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
                <Timer size={16} className="text-[#ff4e26]" /> Pipeline Timing &amp; Model Benchmarks
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Cross-model latency analysis, template compilation speeds, and LangGraph pipeline node execution bottlenecks.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="xs" variant="outline" onClick={() => refetchTiming()} disabled={loadingTiming}>
                <RefreshCw size={12} className={`mr-1 ${loadingTiming ? "animate-spin text-[#ff4e26]" : ""}`} /> Refresh
              </Button>
            </div>
          </div>

          {loadingTiming ? (
            <div className="space-y-4">
              <div className="soft-skeleton h-24" />
              <div className="soft-skeleton h-64" />
            </div>
          ) : !timingData ? (
            <p className="text-xs text-zinc-500 italic py-12 text-center">No timing telemetry recorded yet.</p>
          ) : (
            <>
              {/* Top Summary Stat Grid */}
              {(() => {
                const models = timingData.models_benchmark || []
                const completedModels = models.filter((m) => m.completed_runs > 0 && m.avg_duration_seconds > 0)
                const fastestModel = completedModels.length > 0 ? [...completedModels].sort((a, b) => a.avg_duration_seconds - b.avg_duration_seconds)[0] : null
                const slowestModel = completedModels.length > 0 ? [...completedModels].sort((a, b) => b.avg_duration_seconds - a.avg_duration_seconds)[0] : null
                const totalRuns = models.reduce((acc, m) => acc + m.total_runs, 0)
                const totalTokens = models.reduce((acc, m) => acc + m.total_tokens, 0)

                return (
                  <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
                    <div className="panel-strong p-4">
                      <p className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">Fastest Model</p>
                      <p className="text-lg font-black text-emerald-600 dark:text-emerald-400 mt-1 truncate" title={fastestModel?.model_name || "N/A"}>
                        {fastestModel ? (fastestModel.model_name.includes("/") ? fastestModel.model_name.split("/").slice(1).join("/") : fastestModel.model_name) : "N/A"}
                      </p>
                      <p className="mt-1 text-[10px] font-mono font-bold text-zinc-500">
                        {fastestModel ? `${fastestModel.avg_duration_seconds}s avg` : "--"}
                      </p>
                    </div>
                    <div className="panel-strong p-4">
                      <p className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">Slowest Model</p>
                      <p className="text-lg font-black text-amber-600 dark:text-amber-400 mt-1 truncate" title={slowestModel?.model_name || "N/A"}>
                        {slowestModel ? (slowestModel.model_name.includes("/") ? slowestModel.model_name.split("/").slice(1).join("/") : slowestModel.model_name) : "N/A"}
                      </p>
                      <p className="mt-1 text-[10px] font-mono font-bold text-zinc-500">
                        {slowestModel ? `${slowestModel.avg_duration_seconds}s avg` : "--"}
                      </p>
                    </div>
                    <div className="panel-strong p-4">
                      <p className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">Benchmarked Builds</p>
                      <p className="text-3xl font-black text-[#ff4e26] mt-1">{totalRuns}</p>
                      <p className="mt-1 text-[10px] font-mono font-bold text-zinc-500">Across {models.length} models</p>
                    </div>
                    <div className="panel-strong p-4">
                      <p className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">Total Tokens Tracked</p>
                      <p className="text-2xl font-black text-black dark:text-white mt-1">{totalTokens.toLocaleString()}</p>
                      <p className="mt-1 text-[10px] font-mono font-bold text-zinc-500">Pipeline telemetry</p>
                    </div>
                  </div>
                )
              })()}

              {/* Section 1: Model Benchmark Comparison Grid */}
              <div className="panel-strong p-5 space-y-3">
                <div className="flex flex-wrap justify-between items-center gap-2 border-b dark:border-zinc-700 pb-2">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
                    <Cpu size={15} className="text-[#ff4e26]" /> LLM Model Execution Benchmarks
                  </h3>
                  <Input
                    value={timingSearch}
                    onChange={(e) => setTimingSearch(e.target.value)}
                    placeholder="Filter by model name..."
                    className="h-8 text-xs max-w-xs"
                  />
                </div>

                <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700 font-bold text-zinc-700 dark:text-zinc-300">
                        <th className="p-3">Model Name</th>
                        <th className="p-3 text-center">Volume</th>
                        <th className="p-3">Avg Duration</th>
                        <th className="p-3">P50 / P90</th>
                        <th className="p-3">Min / Max Range</th>
                        <th className="p-3 text-center">Fail Rate</th>
                        <th className="p-3 text-right">Total Tokens</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700 font-medium">
                      {timingData.models_benchmark
                        .filter((m) => !timingSearch || m.model_name.toLowerCase().includes(timingSearch.toLowerCase()))
                        .map((m) => {
                          let speedBadge = "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800"
                          if (m.avg_duration_seconds > 45) speedBadge = "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800"
                          if (m.avg_duration_seconds > 90) speedBadge = "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-800"

                          return (
                            <tr key={m.model_name} className="hover:bg-zinc-50 dark:hover:bg-zinc-800 font-mono">
                              <td className="p-3">
                                <p className="font-extrabold uppercase text-black dark:text-white font-sans text-xs">
                                  {m.model_name.includes("/") ? m.model_name.split("/").slice(1).join("/") : m.model_name}
                                </p>
                                <p className="text-[10px] text-zinc-400 truncate max-w-sm" title={m.model_name}>
                                  {m.model_name}
                                </p>
                              </td>
                              <td className="p-3 text-center">
                                <span className="font-extrabold text-black dark:text-white">{m.total_runs}</span>
                                <span className="text-[10px] text-zinc-400 block font-sans">
                                  {m.completed_runs} ok &bull; {m.failed_runs} fail
                                </span>
                              </td>
                              <td className="p-3">
                                <span className={`px-2 py-0.5 text-xs font-bold border ${speedBadge}`}>
                                  {m.avg_duration_seconds ? `${m.avg_duration_seconds}s` : "--"}
                                </span>
                              </td>
                              <td className="p-3 text-zinc-700 dark:text-zinc-300 text-[11px]">
                                <span className="font-bold">{m.p50_duration_seconds ? `${m.p50_duration_seconds}s` : "--"}</span>
                                <span className="text-zinc-400 mx-1">/</span>
                                <span className="text-zinc-500">{m.p90_duration_seconds ? `${m.p90_duration_seconds}s` : "--"}</span>
                              </td>
                              <td className="p-3 text-[10px] text-zinc-500">
                                {m.min_duration_seconds}s &rarr; {m.max_duration_seconds}s
                              </td>
                              <td className="p-3 text-center">
                                <span className={`text-xs font-bold ${m.failure_rate > 5 ? "text-red-600" : "text-emerald-600"}`}>
                                  {m.failure_rate}%
                                </span>
                              </td>
                              <td className="p-3 text-right font-bold text-black dark:text-white">
                                {m.total_tokens ? m.total_tokens.toLocaleString() : "--"}
                              </td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Section 2: Templates and Node Breakdown Side-by-Side */}
              <div className="grid gap-6 md:grid-cols-2">
                {/* Left: Template Latency Rankings */}
                <div className="panel-strong p-5 space-y-3">
                  <h3 className="text-sm font-bold uppercase tracking-wide border-b dark:border-zinc-700 pb-2 text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
                    <Play size={14} className="text-[#ff4e26]" /> Template Compilation Speeds
                  </h3>
                  <div className="space-y-2">
                    {timingData.templates_benchmark.map((tpl) => (
                      <div key={tpl.template_id} className="p-3 border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60 flex items-center justify-between">
                        <div>
                          <p className="text-xs font-extrabold uppercase text-black dark:text-white">{tpl.template_id}</p>
                          <p className="text-[10px] text-zinc-500 font-mono">{tpl.total_runs} completed generations</p>
                        </div>
                        <div className="text-right font-mono">
                          <span className="text-sm font-extrabold text-black dark:text-white">{tpl.avg_duration_seconds}s</span>
                          <span className="text-[10px] text-zinc-400 block">avg duration</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: Pipeline Node Latency Matrix */}
                <div className="panel-strong p-5 space-y-3">
                  <h3 className="text-sm font-bold uppercase tracking-wide border-b dark:border-zinc-700 pb-2 text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
                    <Layers size={14} className="text-[#ff4e26]" /> LangGraph Node Latencies
                  </h3>
                  <div className="overflow-x-auto max-h-[350px] border border-zinc-200 dark:border-zinc-700">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700 font-bold text-[10px] text-zinc-500 uppercase">
                          <th className="p-2">Node</th>
                          <th className="p-2">Model</th>
                          <th className="p-2 text-right">Avg Latency</th>
                          <th className="p-2 text-right">Calls</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700 font-mono text-[11px]">
                        {timingData.nodes_by_model.slice(0, 15).map((node, i) => (
                          <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-zinc-800">
                            <td className="p-2 font-bold uppercase text-black dark:text-white font-sans text-xs">
                              {node.node_name}
                            </td>
                            <td className="p-2 text-[10px] text-zinc-400 truncate max-w-[120px]" title={node.model}>
                              {node.model}
                            </td>
                            <td className="p-2 text-right font-bold text-zinc-800 dark:text-zinc-200">
                              {(node.avg_latency_ms / 1000).toFixed(2)}s
                            </td>
                            <td className="p-2 text-right text-zinc-500">
                              {node.calls}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Section 3: Slowest Generations Leaderboard */}
              <div className="panel-strong p-5 space-y-3">
                <div className="flex justify-between items-center border-b dark:border-zinc-700 pb-2">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
                    <Activity size={15} className="text-red-500" /> Slowest Generations Leaderboard (Top Bottlenecks)
                  </h3>
                  <span className="text-[10px] font-mono text-zinc-500">Ranked by duration</span>
                </div>

                <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700 font-bold text-zinc-700 dark:text-zinc-300">
                        <th className="p-3">Job &amp; User</th>
                        <th className="p-3">Model</th>
                        <th className="p-3">Template</th>
                        <th className="p-3">Duration</th>
                        <th className="p-3">Date</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700 font-medium">
                      {timingData.slowest_runs.map((run) => (
                        <tr key={run.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800">
                          <td className="p-3">
                            <p className="font-extrabold uppercase text-black dark:text-white">
                              {run.job_title}
                            </p>
                            <p className="text-[10px] text-zinc-500">
                              {run.company} &bull; {run.email}
                            </p>
                          </td>
                          <td className="p-3 font-mono text-[10px] text-zinc-600 dark:text-zinc-400 truncate max-w-[140px]" title={run.model_used}>
                            {run.model_used}
                          </td>
                          <td className="p-3 text-zinc-600 dark:text-zinc-400 font-mono text-[10px]">
                            {run.template_id}
                          </td>
                          <td className="p-3 font-mono font-bold text-red-600 dark:text-red-400">
                            {run.duration_seconds}s
                          </td>
                          <td className="p-3 font-mono text-[10px] text-zinc-500">
                            {new Date(run.created_at).toLocaleDateString()}
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex justify-end gap-1.5">
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => setSelectedTimingGen({
                                  id: run.id,
                                  user_id: "",
                                  template_id: run.template_id,
                                  job_title: run.job_title,
                                  company: run.company,
                                  model_used: run.model_used,
                                  status: "completed",
                                  created_at: run.created_at,
                                  completed_at: run.completed_at,
                                  duration_seconds: run.duration_seconds,
                                  is_guest: false,
                                  intermediate_resume_count: 0,
                                })}
                              >
                                <Timer size={12} className="mr-1 text-[#ff4e26]" /> Waterfall
                              </Button>
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => {
                                  setViewingLogsGenId(run.id)
                                  setActiveTab("generations")
                                }}
                              >
                                <Terminal size={12} />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* PROMPT MANAGER TAB */}
      {activeTab === "prompts" && (
        <div className="pixel-enter grid min-w-0 gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-6">
          {/* Prompt library */}
          <div className="panel-strong flex min-w-0 flex-col gap-3 p-4">
            <div className="flex items-center justify-between gap-2 border-b border-zinc-200 pb-2 dark:border-zinc-700">
              <h3 className="text-[10px] font-extrabold uppercase tracking-widest text-[#ff4e26]">Prompt library</h3>
              <span className="font-mono text-[10px] text-zinc-500">{filteredPrompts.length}/{prompts.length}</span>
            </div>
            <Input
              value={promptSearch}
              onChange={(e) => setPromptSearch(e.target.value)}
              placeholder="Filter prompts"
              className="h-8 text-xs"
            />
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:mx-0 lg:max-h-[60vh] lg:flex-col lg:gap-1 lg:overflow-x-visible lg:overflow-y-auto lg:px-0">
              {loadingPrompts ? (
                <div className="soft-skeleton h-24 w-full lg:w-auto" />
              ) : filteredPrompts.length === 0 ? (
                <p className="text-xs text-zinc-500 italic">
                  {prompts.length === 0
                    ? "No prompts registered in database. Run a generation to seed them."
                    : "No prompts match your filter."}
                </p>
              ) : (
                filteredPrompts.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    title={p.name}
                    className={cn(
                      "shrink-0 border px-3 py-2 text-left transition-colors lg:w-full lg:shrink",
                      selectedPrompt?.name === p.name
                        ? "border-[#ff4e26] bg-orange-50 text-[#ff4e26] dark:bg-orange-950/40"
                        : "border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    )}
                    onClick={() => selectPromptForEditing(p)}
                  >
                    <span className="block truncate font-mono text-[11px] font-semibold">{p.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Editor + Playground */}
          <div className="grid min-w-0 gap-4 lg:gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
            {selectedPrompt ? (
              <>
                {/* Prompt Editor */}
                <div className="panel-strong flex min-w-0 flex-col space-y-4 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2 border-b border-zinc-200 pb-3 dark:border-zinc-700">
                    <div className="min-w-0">
                      <h3 className="text-sm font-extrabold uppercase tracking-wide text-black dark:text-white">Edit prompt</h3>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-[#ff4e26]" title={selectedPrompt.name}>
                        {selectedPrompt.name}
                      </p>
                    </div>
                    <span className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                      {selectedPrompt.updated_at
                        ? `Updated ${new Date(selectedPrompt.updated_at).toLocaleString()}`
                        : "Never updated"}
                    </span>
                  </div>

                  <div className="flex flex-col space-y-1.5 lg:min-h-0 lg:flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <Label htmlFor="system-prompt" className="text-xs font-bold text-zinc-700 dark:text-zinc-300">System prompt</Label>
                      <span className="font-mono text-[10px] text-zinc-400">{systemPromptVal.length} chars</span>
                    </div>
                    <Textarea
                      id="system-prompt"
                      rows={16}
                      className="min-w-0 font-mono text-xs leading-relaxed lg:min-h-0 lg:flex-1"
                      value={systemPromptVal}
                      onChange={(e) => setSystemPromptVal(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <Label htmlFor="user-prompt" className="text-xs font-bold text-zinc-700 dark:text-zinc-300">User prompt template</Label>
                      <span className="font-mono text-[10px] text-zinc-400">{userPromptVal.length} chars</span>
                    </div>
                    <Textarea
                      id="user-prompt"
                      rows={9}
                      className="min-w-0 font-mono text-xs leading-relaxed"
                      value={userPromptVal}
                      onChange={(e) => setUserPromptVal(e.target.value)}
                      placeholder="Optional. Use {curly_braces} for variables filled in by the playground."
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-700">
                    <Button
                      size="sm"
                      disabled={updatePromptMutation.isPending || !isPromptDirty}
                      onClick={() => updatePromptMutation.mutate({
                        name: selectedPrompt.name,
                        system_prompt: systemPromptVal,
                        user_prompt: userPromptVal || undefined
                      })}
                    >
                      {updatePromptMutation.isPending ? "Saving..." : "Save changes"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!isPromptDirty || updatePromptMutation.isPending}
                      onClick={discardPromptEdits}
                    >
                      Discard
                    </Button>
                    {isPromptDirty && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">Unsaved changes</span>
                    )}
                  </div>
                </div>

                {/* Prompt Playground */}
                <div className="panel-strong flex min-w-0 flex-col space-y-4 p-5">
                  <div className="flex items-center justify-between gap-2 border-b border-zinc-200 pb-2 dark:border-zinc-700">
                    <h3 className="text-[10px] font-extrabold uppercase tracking-widest text-[#ff4e26]">Playground</h3>
                    <span className="truncate font-mono text-[10px] text-zinc-500" title={selectedPrompt.name}>{selectedPrompt.name}</span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <Label htmlFor="playground-variables" className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Variables</Label>
                      <button
                        type="button"
                        onClick={formatPlaygroundVariables}
                        className="cursor-pointer font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:text-[#ff4e26] dark:text-zinc-400"
                      >
                        Format
                      </button>
                    </div>
                    <Textarea
                      id="playground-variables"
                      rows={6}
                      className="min-w-0 font-mono text-xs"
                      value={playgroundVariables}
                      onChange={(e) => setPlaygroundVariables(e.target.value)}
                      placeholder='{"job_desc":"..."}'
                    />
                    <p className="text-[10px] text-zinc-500">JSON object merged into the user prompt template.</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button size="xs" onClick={() => runPlaygroundMutation.mutate()} disabled={runPlaygroundMutation.isPending}>
                      {runPlaygroundMutation.isPending ? "Running..." : "Run once"}
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => runBulkMutation.mutate()} disabled={runBulkMutation.isPending}>
                      {runBulkMutation.isPending ? "Running..." : "Run bulk cases"}
                    </Button>
                  </div>

                  <div className="space-y-1.5 border-t border-zinc-200 pt-3 dark:border-zinc-700">
                    <div className="flex items-baseline justify-between gap-2">
                      <Label htmlFor="playground-bulk" className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Bulk cases</Label>
                      <span className="font-mono text-[10px] text-zinc-400">{bulkCaseCount} cases</span>
                    </div>
                    <Textarea
                      id="playground-bulk"
                      rows={4}
                      className="min-w-0 font-mono text-xs"
                      value={bulkCases}
                      onChange={(e) => setBulkCases(e.target.value)}
                      placeholder='[{"job_desc":"case 1"},{"job_desc":"case 2"}]'
                    />
                  </div>

                  {playgroundError && (
                    <p className="border border-red-300 bg-red-50 p-2 text-[11px] font-semibold text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300">
                      {playgroundError}
                    </p>
                  )}

                  <div className="space-y-1.5 border-t border-zinc-200 pt-3 dark:border-zinc-700">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-zinc-500">Output</h4>
                      {playgroundResult && (
                        <button
                          type="button"
                          onClick={copyPlaygroundOutput}
                          className="cursor-pointer font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:text-[#ff4e26] dark:text-zinc-400"
                        >
                          {outputCopied ? "Copied" : "Copy"}
                        </button>
                      )}
                    </div>
                    {playgroundResult ? (
                      <pre className="max-h-[320px] min-w-0 overflow-auto border border-zinc-200 bg-zinc-950 p-3 font-mono text-xs text-zinc-100 whitespace-pre-wrap break-words dark:border-zinc-700">{playgroundResult}</pre>
                    ) : (
                      <p className="border border-dashed border-zinc-300 p-3 text-xs text-zinc-500 dark:border-zinc-700">
                        Run the prompt to see its output here.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-700 lg:min-h-0 lg:flex-1">
                    <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-zinc-500">Recent runs</h4>
                    {promptRuns.length === 0 ? (
                      <p className="text-xs text-zinc-500 italic">No test runs recorded yet.</p>
                    ) : (
                      <div className="max-h-64 space-y-1.5 overflow-y-auto pr-0.5 lg:max-h-none lg:min-h-0 lg:flex-1">
                        {promptRuns.slice(0, 12).map((run) => (
                          <button
                            key={run.id}
                            type="button"
                            title="Load this run's output into the output panel"
                            onClick={() => showRunOutput(run)}
                            className="w-full cursor-pointer border border-zinc-200 p-2 text-left transition-colors hover:border-[#ff4e26] dark:border-zinc-700 dark:hover:border-[#ff4e26]"
                          >
                            <div className="flex items-baseline justify-between gap-2 font-mono text-[10px]">
                              <span className="font-bold text-zinc-700 dark:text-zinc-300">{run.prompt_name}</span>
                              <span className={run.status === "failed" ? "font-bold text-red-600 dark:text-red-400" : "text-zinc-500"}>
                                {run.status} · {Math.round(run.latency_ms || 0)}ms
                              </span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-[11px] text-zinc-500">{run.output || run.error_message || "No output"}</p>
                            <p className="mt-1 font-mono text-[9px] text-zinc-400">{new Date(run.created_at).toLocaleString()}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="panel-strong flex min-w-0 items-center justify-center p-10 text-center xl:col-span-2">
                <p className="text-sm font-semibold italic text-zinc-400">
                  Select a prompt from the library to view and edit its template.
                </p>
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
          <div className="grid grid-cols-2 gap-3">
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
              <p className="text-2xl font-black mt-1 text-amber-600 dark:text-amber-400 flex items-center gap-1">
                {feedbackAnalytics?.avg_rating ?? "N/A"}
              </p>
            </div>
            <div className="panel-strong p-4 bg-white dark:bg-zinc-900 border-2 border-black">
              <p className="text-[10px] font-black uppercase tracking-wider text-zinc-400">Total Reviews</p>
              <p className="text-2xl font-black mt-1">{feedbackAnalytics?.total_ratings ?? 0}</p>
            </div>
          </div>

          {/* Sub-tab Toggle & Controls */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-700 pb-3">
            <div className="flex w-full gap-2 sm:w-auto">
              <Button
                size="sm"
                variant={feedbackSubTab === "reports" ? "default" : "outline"}
                onClick={() => setFeedbackSubTab("reports")}
              >
                <MessageSquare size={14} className="mr-1.5" /> Issues
              </Button>
              <Button
                size="sm"
                variant={feedbackSubTab === "ratings" ? "default" : "outline"}
                onClick={() => setFeedbackSubTab("ratings")}
              >
                <Star size={14} className="mr-1.5" /> Ratings
              </Button>
            </div>

          </div>

          {feedbackSubTab === "reports" && <AdminIssueInbox />}

          {/* Sub-tab 2: Ratings List */}
          {feedbackSubTab === "ratings" && (
            <div className="panel-strong bg-white dark:bg-zinc-900 border-2 border-black overflow-hidden">
              {loadingRatings ? (
                <div className="p-8 text-center text-xs font-mono text-zinc-500">Loading ratings...</div>
              ) : ratingsError ? (
                <p role="alert" className="p-6 text-sm">Ratings could not be loaded. Use Refresh to try again.</p>
              ) : feedbackRatings.length === 0 ? (
                <div className="p-8 text-center text-xs font-mono text-zinc-500">No ratings submitted yet.</div>
              ) : (
                <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {feedbackRatings.map((rating) => (
                    <li key={rating.id} className="space-y-3 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="break-all font-bold">{rating.user_email || rating.user_name || "User"}</span>
                        <time dateTime={rating.created_at} className="text-zinc-500">{new Date(rating.created_at).toLocaleDateString()}</time>
                      </div>
                      <div className="flex items-center gap-1" aria-label={`${rating.star_rating} out of 5 stars`}>
                        {[1, 2, 3, 4, 5].map((star) => <Star key={star} size={15} aria-hidden="true" className={star <= rating.star_rating ? "fill-amber-400 text-amber-600" : "text-zinc-300 dark:text-zinc-700"} />)}
                      </div>
                      <p className="whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">{rating.comment || "No comment left"}</p>
                      {rating.generation_job_title && <p className="break-words text-xs text-zinc-500">{rating.generation_job_title}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}


        </div>
      )}
      {selectedTimingGen && (
        <TimingWaterfallModal
          generation={selectedTimingGen}
          onClose={() => setSelectedTimingGen(null)}
        />
      )}
        </div>
      </div>
    </div>
  )
}
