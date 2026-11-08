"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, ArrowUpDown, Download, FileText, MoreHorizontal, RefreshCw, Terminal, Timer, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { GenerationItem, GenerationNodeDetail, LogItem } from "../api-types"
import { FIELD_CLASS, Note, Panel, Pill, Skeleton, fetchJson, formatDuration, sendJson, statusTone } from "../shared"

type SortField = "job_title" | "model_used" | "status" | "duration_seconds" | "created_at"

function LiveElapsedTimer({ startTime }: { startTime: string }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = new Date(startTime).getTime()
    const update = () => setElapsed(Math.max(0, Math.round((Date.now() - start) / 1000)))
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [startTime])
  return (
    <span className="inline-flex items-center gap-1 font-mono font-bold text-amber-600 dark:text-amber-400">
      <span className="inline-block h-1.5 w-1.5 animate-ping rounded-full bg-amber-500" />
      {formatDuration(elapsed)}
    </span>
  )
}

export function Duration({ gen }: { gen: Pick<GenerationItem, "status" | "created_at" | "duration_seconds"> }) {
  if (gen.status === "in_progress" || gen.status === "pending") return <LiveElapsedTimer startTime={gen.created_at} />
  const tone = gen.status === "completed" ? "text-green-700 dark:text-green-400" : gen.status === "failed" ? "text-red-600 dark:text-red-400" : "text-zinc-400"
  return <span className={cn("font-mono font-bold", tone)}>{formatDuration(gen.duration_seconds)}</span>
}

const NODE_COLORS = ["#ff4e26", "#f59e0b", "#10b981", "#06b6d4", "#6366f1", "#a855f7", "#ec4899"]

export function TimingWaterfallModal({ generation, onClose }: { generation: GenerationItem; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const { data: metrics = [], isLoading } = useQuery<GenerationNodeDetail[]>({
    queryKey: ["admin", "generation-metrics", generation.id],
    queryFn: () => fetchJson<GenerationNodeDetail[]>(`/api/backend/admin/generations/${generation.id}/metrics`),
  })
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  const totalMs = metrics.reduce((acc, m) => acc + (m.latency_ms || 0), 0)
  const totalTokens = metrics.reduce((acc, m) => acc + (m.total_tokens || 0), 0)

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Timing breakdown">
      <div className="max-h-[90dvh] w-full max-w-2xl space-y-4 overflow-y-auto border border-zinc-300 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl dark:border-zinc-700 dark:bg-zinc-900 sm:p-5">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-800">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-[#ff4e26]">Latency telemetry</p>
            <h3 className="break-words text-base font-extrabold text-black dark:text-white">{generation.job_title || "Generation"}</h3>
            <p className="mt-0.5 break-all font-mono text-[11px] text-zinc-500">
              {generation.id} · {generation.duration_seconds ? formatDuration(generation.duration_seconds) : `${(totalMs / 1000).toFixed(1)}s`} · {totalTokens.toLocaleString()} tokens
            </p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center text-zinc-500 hover:text-black dark:hover:text-white">
            <X size={20} />
          </button>
        </div>

        {isLoading ? (
          <Skeleton className="h-40" />
        ) : metrics.length === 0 ? (
          <p className="py-8 text-center text-xs italic text-zinc-500">No node metrics recorded for this run.</p>
        ) : (
          <>
            <div className="space-y-1.5">
              <div className="flex justify-between font-mono text-[11px] font-bold uppercase text-zinc-500">
                <span>Execution waterfall</span>
                <span>{metrics.length} nodes</span>
              </div>
              <div className="flex h-3.5 w-full overflow-hidden border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">
                {metrics.map((m, idx) => {
                  const pct = totalMs > 0 ? ((m.latency_ms || 0) / totalMs) * 100 : 0
                  return <div key={m.id} className="h-full" style={{ width: `${Math.max(2, pct)}%`, background: NODE_COLORS[idx % NODE_COLORS.length] }} title={`${m.node_name}: ${((m.latency_ms || 0) / 1000).toFixed(2)}s`} />
                })}
              </div>
            </div>
            <ul className="divide-y divide-zinc-200 border border-zinc-200 text-xs dark:divide-zinc-800 dark:border-zinc-800">
              {metrics.map((m, idx) => {
                const pct = totalMs > 0 ? Math.round(((m.latency_ms || 0) / totalMs) * 100) : 0
                return (
                  <li key={m.id} className="flex items-start justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-extrabold uppercase text-black dark:text-white">
                        <span aria-hidden="true" className="inline-block h-2.5 w-2.5" style={{ background: NODE_COLORS[idx % NODE_COLORS.length] }} />
                        <span className="break-all">{m.node_name}</span>
                        {m.fallback_used && <Pill tone="warn">Fallback</Pill>}
                        {m.status === "error" && <Pill tone="bad">Error</Pill>}
                      </p>
                      <p className="mt-0.5 break-all font-mono text-[10px] text-zinc-500">
                        {m.provider} · {m.model || "default"} · {m.total_tokens ? `${m.total_tokens} tokens` : "0 tokens"}
                      </p>
                      {m.error_message && <p className="mt-0.5 break-words text-[11px] font-semibold text-red-600">{m.error_message}</p>}
                    </div>
                    <div className="shrink-0 text-right font-mono">
                      <p className="font-extrabold text-black dark:text-white">{((m.latency_ms || 0) / 1000).toFixed(2)}s</p>
                      <p className="text-[10px] text-zinc-400">{pct}%</p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

function LogsView({ generationId, onBack }: { generationId: string; onBack: () => void }) {
  const queryClient = useQueryClient()
  const streamRef = useRef<EventSource | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [liveLogs, setLiveLogs] = useState<LogItem[]>([])
  const { data: logs = [], isLoading } = useQuery<LogItem[]>({
    queryKey: ["admin", "logs", generationId],
    queryFn: () => fetchJson<LogItem[]>(`/api/backend/admin/generations/${generationId}/logs`),
  })

  const stop = () => {
    streamRef.current?.close()
    streamRef.current = null
    setIsStreaming(false)
  }
  useEffect(() => () => streamRef.current?.close(), [])

  const start = () => {
    if (streamRef.current) return
    setLiveLogs([])
    const stream = new EventSource(`/api/backend/admin/generations/${generationId}/stream`)
    streamRef.current = stream
    setIsStreaming(true)
    stream.addEventListener("log", (event) => setLiveLogs((current) => [...current, JSON.parse((event as MessageEvent).data)]))
    stream.addEventListener("done", () => {
      stop()
      queryClient.invalidateQueries({ queryKey: ["admin", "logs", generationId] })
    })
    stream.onerror = stop
  }

  const shown = liveLogs.length > 0 ? liveLogs : logs
  const exportLogs = () => {
    const lines = shown.map((log) => `${log.timestamp} [${log.level}] ${log.node_name ? `[${log.node_name}] ` : ""}${log.message}`)
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `generation-${generationId}-logs.txt`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Panel className="space-y-4">
      <div className="space-y-2 border-b border-zinc-200 pb-3 dark:border-zinc-700">
        <h3 className="text-sm font-bold uppercase tracking-wide">Logs</h3>
        <p className="break-all font-mono text-[11px] text-zinc-500">{generationId}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="min-h-11 sm:min-h-8" onClick={onBack}>
            <ArrowLeft size={12} /> Back
          </Button>
          <Button size="sm" variant="outline" className="min-h-11 sm:min-h-8" onClick={isStreaming ? stop : start}>
            {isStreaming ? "Stop live" : "Live stream"}
          </Button>
          <Button size="sm" variant="outline" className="min-h-11 sm:min-h-8" onClick={exportLogs} disabled={shown.length === 0}>
            Export
          </Button>
        </div>
      </div>
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : shown.length === 0 ? (
        <p className="py-8 text-center text-xs italic text-zinc-500">No logs found for this run.</p>
      ) : (
        <div className="max-h-[60dvh] space-y-2 overflow-y-auto bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-white">
          {shown.map((log) => (
            <div key={log.id} className="break-words">
              <span className="text-zinc-500">{new Date(log.timestamp).toLocaleTimeString()} </span>
              <span className={cn("font-bold uppercase", log.level === "error" ? "text-red-400" : log.level === "warning" ? "text-amber-400" : "text-zinc-400")}>[{log.level}] </span>
              {log.node_name && <span className="text-cyan-400">[{log.node_name}] </span>}
              <span className="[overflow-wrap:anywhere]">{log.message}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

export function GenerationsTab({ initialLogsId, onWaterfall }: { initialLogsId?: string | null; onWaterfall: (gen: GenerationItem) => void }) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("")
  const [userType, setUserType] = useState("")
  const [sortField, setSortField] = useState<SortField>("created_at")
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc")
  const [logsId, setLogsId] = useState<string | null>(initialLogsId ?? null)

  const { data: generations = [], isLoading } = useQuery<GenerationItem[]>({
    queryKey: ["admin", "generations", search, status, userType],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "50" })
      if (search.trim()) params.set("search", search.trim())
      if (status) params.set("status_filter", status)
      if (userType) params.set("user_type", userType)
      return fetchJson<GenerationItem[]>(`/api/backend/admin/generations?${params}`)
    },
  })

  const retry = useMutation({
    mutationFn: (id: string) => sendJson(`/api/backend/admin/generations/${id}/retry`, "POST", undefined, "Failed to retry generation"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "generations"] })
      alert("Generation restarted successfully!")
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => sendJson(`/api/backend/admin/generations/${id}`, "DELETE", undefined, "Failed to delete generation"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "generations"] }),
  })

  const sorted = useMemo(() => {
    const dir = sortOrder === "asc" ? 1 : -1
    const text = (g: GenerationItem) => (sortField === "job_title" ? g.job_title || g.email || "" : String(g[sortField] ?? "")).toLowerCase()
    return [...generations].sort((a, b) => {
      if (sortField === "created_at") return dir * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      if (sortField === "duration_seconds") return dir * ((a.duration_seconds ?? (dir > 0 ? 999999 : -1)) - (b.duration_seconds ?? (dir > 0 ? 999999 : -1)))
      return dir * text(a).localeCompare(text(b))
    })
  }, [generations, sortField, sortOrder])

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))
    else {
      setSortField(field)
      setSortOrder(field === "job_title" || field === "model_used" || field === "status" ? "asc" : "desc")
    }
  }

  if (logsId) return <LogsView generationId={logsId} onBack={() => setLogsId(null)} />

  const actions = (gen: GenerationItem, layout: "menu" | "grid") => {
    const item = "flex w-full min-h-11 cursor-pointer items-center gap-2 px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-300 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:disabled:text-zinc-600"
    const wrapped = layout === "grid" ? `${item} border border-zinc-200 dark:border-zinc-700` : item
    return (
      <>
        <button type="button" className={wrapped} onClick={() => onWaterfall(gen)}>
          <Timer size={13} className="text-[#ff4e26]" /> Timing
        </button>
        <button type="button" className={wrapped} onClick={() => setLogsId(gen.id)}>
          <Terminal size={13} /> Logs
        </button>
        <button type="button" className={wrapped} disabled={gen.status !== "completed"} onClick={() => (window.location.href = `/api/backend/admin/generations/${gen.id}/download`)}>
          <Download size={13} /> Final résumé
        </button>
        <button type="button" className={wrapped} disabled={gen.intermediate_resume_count === 0} onClick={() => (window.location.href = `/api/backend/admin/generations/${gen.id}/intermediate/0/download`)}>
          <FileText size={13} /> Intermediate
        </button>
        <button type="button" className={wrapped} disabled={gen.status !== "failed"} onClick={() => retry.mutate(gen.id)}>
          <RefreshCw size={13} /> Retry
        </button>
        <button
          type="button"
          className={cn(wrapped, "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40")}
          onClick={() => confirm("Delete this generation and its storage artifacts?") && remove.mutate(gen.id)}
        >
          <Trash2 size={13} /> Delete
        </button>
      </>
    )
  }

  const sortHead = (field: SortField, children: string) => (
    <th key={field} className="p-3" aria-sort={sortField === field ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => toggleSort(field)} className="inline-flex cursor-pointer items-center gap-1 font-bold hover:text-black dark:hover:text-white">
        {children}
        {sortField === field ? <span className="font-mono text-[10px] text-[#ff4e26]">{sortOrder === "asc" ? "▲" : "▼"}</span> : <ArrowUpDown size={11} className="opacity-50" />}
      </button>
    </th>
  )

  return (
    <div className="space-y-4 pixel-enter">
      <div className="grid gap-2 border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900 sm:grid-cols-2 lg:grid-cols-[1fr_150px_150px_170px]">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search job, company, model, email" aria-label="Search generations" className={cn(FIELD_CLASS, "sm:col-span-2 lg:col-span-1")} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className={FIELD_CLASS}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
        <select value={userType} onChange={(e) => setUserType(e.target.value)} aria-label="Filter by user type" className={FIELD_CLASS}>
          <option value="">All users</option>
          <option value="user">Signed-in</option>
          <option value="guest">Guest</option>
        </select>
        <select
          value={`${sortField}:${sortOrder}`}
          onChange={(e) => {
            const [field, order] = e.target.value.split(":")
            setSortField(field as SortField)
            setSortOrder(order as "asc" | "desc")
          }}
          aria-label="Sort generations"
          className={cn(FIELD_CLASS, "lg:hidden")}
        >
          <option value="created_at:desc">Newest first</option>
          <option value="created_at:asc">Oldest first</option>
          <option value="duration_seconds:desc">Slowest first</option>
          <option value="duration_seconds:asc">Fastest first</option>
          <option value="status:asc">Status A–Z</option>
          <option value="model_used:asc">Model A–Z</option>
        </select>
      </div>

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : generations.length === 0 ? (
        <Note>No generations match these filters.</Note>
      ) : (
        <>
          {/* Phone and tablet: one card per build */}
          <ul className="space-y-3 lg:hidden">
            {sorted.map((gen) => (
              <li key={gen.id} className="panel-strong p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-extrabold text-black dark:text-white">{gen.job_title || "Unknown title"}</p>
                    <p className="[overflow-wrap:anywhere] text-[11px] text-zinc-500">
                      {gen.company || "No company"} · {gen.email || (gen.is_guest ? "Guest" : gen.user_id)}
                    </p>
                  </div>
                  <Pill tone={statusTone(gen.status)} className="shrink-0">{gen.status.replace("_", " ")}</Pill>
                </div>
                {gen.error_message && <p className="mt-2 break-words text-[11px] font-semibold text-red-600">{gen.error_message}</p>}
                <dl className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="min-w-0">
                    <dt className="text-zinc-500">Model</dt>
                    <dd className="break-all font-mono text-zinc-700 dark:text-zinc-300">{gen.model_used}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Duration</dt>
                    <dd><Duration gen={gen} /></dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-zinc-500">Created</dt>
                    <dd className="font-mono text-zinc-700 dark:text-zinc-300">{new Date(gen.created_at).toLocaleString()}</dd>
                  </div>
                </dl>
                <details className="mt-3 border-t border-zinc-200 pt-2 dark:border-zinc-700">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-300">
                    <MoreHorizontal size={14} /> Actions
                  </summary>
                  <div className="mt-1 grid grid-cols-2 gap-2">{actions(gen, "grid")}</div>
                </details>
              </li>
            ))}
          </ul>

          {/* Desktop: sortable table */}
          <div className="hidden overflow-x-auto border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 lg:block">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {sortHead("job_title", "Job & user")}
                  {sortHead("model_used", "Model")}
                  {sortHead("status", "Status")}
                  {sortHead("duration_seconds", "Duration")}
                  {sortHead("created_at", "Created")}
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 font-medium dark:divide-zinc-700">
                {sorted.map((gen) => (
                  <tr key={gen.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800">
                    <td className="p-3">
                      <p className="font-extrabold text-black dark:text-white">{gen.job_title || "Unknown title"}</p>
                      <p className="text-[10px] text-zinc-500">{gen.company || "No company"} · {gen.email || (gen.is_guest ? "Guest" : gen.user_id)}</p>
                    </td>
                    <td className="p-3 font-mono text-[10px] text-zinc-600 dark:text-zinc-400">{gen.model_used}</td>
                    <td className="p-3">
                      <Pill tone={statusTone(gen.status)}>{gen.status.replace("_", " ")}</Pill>
                      {gen.error_message && <p className="mt-1 max-w-xs truncate text-[10px] font-semibold text-red-600" title={gen.error_message}>{gen.error_message}</p>}
                    </td>
                    <td className="p-3 text-[11px]"><Duration gen={gen} /></td>
                    <td className="p-3 font-mono text-[10px] text-zinc-500">{new Date(gen.created_at).toLocaleString()}</td>
                    <td className="p-3 text-right">
                      <details className="relative inline-block text-left">
                        <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1 bg-zinc-100 px-3 text-xs font-bold text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">
                          <MoreHorizontal size={13} /> Options
                        </summary>
                        <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">{actions(gen, "menu")}</div>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
