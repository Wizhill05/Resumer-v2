"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState, useEffect, useRef } from "react"
import { RefreshCw, LayoutList, LayoutGrid, Trash2, FileText } from "lucide-react"

type HistoryRun = {
  id: string
  job_title?: string
  company?: string
  status: string
  created_at: string
  template_id: string
  model_used: string
  thumb_storage_key?: string
}

const nodeProgressMap: Record<string, number> = {
  job_analysis: 15,
  summary_skills: 25,
  experience_writer: 30,
  projects_writer: 35,
  assembly: 40,
  renderer: 45,
  orphan_repair: 65,
  content_reduction: 75,
  saver: 95,
}

function useLiveProgress(runId: string, enabled: boolean, onDone: () => void) {
  const [percent, setPercent] = useState(10)
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  useEffect(() => {
    if (!enabled) return

    let active = true
    let since = 0
    let timer: ReturnType<typeof setInterval> | null = null

    const poll = async () => {
      if (!active) return
      try {
        const res = await fetch(`/api/backend/generate/${runId}/logs?since=${since}`)
        if (!res.ok) return
        const data = await res.json()
        const logs = (data.logs ?? []) as Array<{
          id: number
          node: string | null
          message: string
          level: string
        }>
        for (const log of logs) {
          since = log.id
          if (
            log.level === "status" &&
            (log.message === "completed" || log.message === "failed")
          ) {
            active = false
            if (timer) clearInterval(timer)
            onDoneRef.current()
            return
          }
          if (log.node) {
            const p = nodeProgressMap[log.node]
            if (p) setPercent((prev) => Math.max(prev, p))
          }
        }
        if (data.status === "completed" || data.status === "failed") {
          active = false
          if (timer) clearInterval(timer)
          onDoneRef.current()
        }
      } catch {
        // transient network error — retry next tick
      }
    }

    poll()
    timer = setInterval(poll, 3000)

    return () => {
      active = false
      if (timer) clearInterval(timer)
    }
  }, [runId, enabled])

  return percent
}

type ViewMode = "list" | "grid"

function StatusDot({ status }: { status: string }) {
  if (status === "completed")
    return <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 shrink-0 mt-[5px]" />
  if (status === "failed")
    return <span className="inline-block w-2 h-2 rounded-full bg-red-400 shrink-0 mt-[5px]" />
  return <span className="inline-block w-2 h-2 rounded-full bg-amber-400 shrink-0 mt-[5px] animate-pulse" />
}

function useDeleteRun() {
  const queryClient = useQueryClient()
  return async (id: string) => {
    if (!window.confirm("Delete this resume from history?")) return
    await fetch(`/api/backend/generate/${id}`, { method: "DELETE" })
    queryClient.setQueryData<HistoryRun[]>(["history"], (old) =>
      (old ?? []).filter((r) => r.id !== id)
    )
  }
}

function LiveProgressRow({
  run,
  onDelete,
  refetch,
}: {
  run: HistoryRun
  onDelete: (id: string) => void
  refetch: () => void
}) {
  const percent = useLiveProgress(run.id, true, refetch)
  const date = new Date(run.created_at).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  })

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5 transition-all duration-150 group bg-zinc-50/50">
      {/* Left: dot + info */}
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <StatusDot status="in_progress" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-semibold leading-snug text-zinc-900">
              {run.job_title || "Tailored Resume"}
            </span>
            {run.company && (
              <span className="text-sm text-zinc-400 font-normal truncate">
                at {run.company}
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            {date}
            <span className="mx-1.5 text-zinc-300">·</span>
            {run.template_id}
            <span className="mx-1.5 text-zinc-300">·</span>
            {run.model_used}
            <span className="mx-1.5 text-zinc-300">·</span>
            <span className="text-amber-500 font-medium">generating ({percent}%)</span>
          </p>
          
          {/* Progress bar */}
          <div className="w-full bg-zinc-100 h-1 mt-2 rounded-full overflow-hidden">
            <div
              className="bg-[#ff4e26] h-full transition-all duration-500 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Right: delete */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(run.id) }}
        className="shrink-0 p-1.5 text-zinc-300 hover:text-red-500 rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
        aria-label="Delete"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

function LiveProgressGridCard({
  run,
  onDelete,
  refetch,
}: {
  run: HistoryRun
  onDelete: (id: string) => void
  refetch: () => void
}) {
  const percent = useLiveProgress(run.id, true, refetch)
  const date = new Date(run.created_at).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  })

  return (
    <div className="bg-white border border-gray-200 overflow-hidden flex flex-col group hover:border-gray-400 transition-colors">
      {/* Thumbnail placeholder with progress */}
      <div className="relative border-b border-gray-200 bg-zinc-50" style={{ aspectRatio: "210/297" }}>
        <div className="w-full h-full flex flex-col items-center justify-center p-4 gap-3">
          <FileText size={28} className="text-zinc-300 animate-pulse" />
          <span className="text-xs text-amber-500 font-medium">Generating… {percent}%</span>
          
          {/* Progress bar */}
          <div className="w-2/3 bg-zinc-200 h-1 rounded-full overflow-hidden">
            <div
              className="bg-[#ff4e26] h-full transition-all duration-500 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        {/* Delete overlay button */}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(run.id) }}
          className="absolute top-2 right-2 p-1.5 bg-white/90 border border-gray-200 rounded text-zinc-400 hover:text-red-500 hover:border-red-300 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
          aria-label="Delete"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Footer */}
      <div className="px-3 py-3">
        <div className="flex items-start gap-1.5">
          <StatusDot status="in_progress" />
          <span className="text-sm font-semibold leading-snug truncate text-zinc-900">
            {run.job_title || "Tailored Resume"}
          </span>
        </div>
        <p className="text-xs text-zinc-400 mt-0.5 truncate pl-3.5">
          {run.company ? `${run.company} · ` : ""}{date}
        </p>
      </div>
    </div>
  )
}

function GridCard({ run, onDelete }: { run: HistoryRun; onDelete: (id: string) => void }) {
  const date = new Date(run.created_at).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  })
  const completed = run.status === "completed"
  const failed = run.status === "failed"

  return (
    <div className="bg-white border border-gray-200 overflow-hidden flex flex-col group hover:border-gray-400 transition-colors">
      {/* Thumbnail */}
      <div
        className={`relative border-b border-gray-200 bg-zinc-50 ${completed ? "cursor-pointer" : ""}`}
        style={{ aspectRatio: "210/297" }}
        onClick={() => completed && window.open(`/api/backend/generate/${run.id}/download`, "_blank")}
      >
        {completed && run.thumb_storage_key ? (
          <img
            src={`/api/backend/generate/${run.id}/thumb`}
            alt={`${run.job_title || "Resume"} preview`}
            className="w-full h-full object-cover object-top"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2">
            <FileText size={28} className="text-zinc-300" />
            {failed && <span className="text-xs text-red-400 font-medium">Failed</span>}
            {!completed && !failed && (
              <span className="text-xs text-amber-500 font-medium">Processing…</span>
            )}
          </div>
        )}

        {/* Delete overlay button */}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(run.id) }}
          className="absolute top-2 right-2 p-1.5 bg-white/90 border border-gray-200 rounded text-zinc-400 hover:text-red-500 hover:border-red-300 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
          aria-label="Delete"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Footer */}
      <div
        className={`px-3 py-3 cursor-pointer transition-all duration-150 ${completed ? "hover:bg-[#ff4e26] hover:[&_.title-span]:text-white hover:[&_.date-p]:text-zinc-200" : ""}`}
        onClick={() => completed && window.open(`/api/backend/generate/${run.id}/download`, "_blank")}
      >
        <div className="flex items-start gap-1.5">
          <StatusDot status={run.status} />
          <span className={`title-span text-sm font-semibold leading-snug truncate transition-colors duration-150 ${failed ? "text-zinc-400 line-through" : "text-zinc-900"}`}>
            {run.job_title || "Tailored Resume"}
          </span>
        </div>
        <p className="date-p text-xs text-zinc-400 mt-0.5 truncate pl-3.5 transition-colors duration-150">
          {run.company ? `${run.company} · ` : ""}{date}
        </p>
      </div>
    </div>
  )
}

export function HistoryClient() {
  const { data: runs = [], isLoading, error, refetch } = useQuery<HistoryRun[]>({
    queryKey: ["history"],
    queryFn: async () => {
      const res = await fetch("/api/backend/generate")
      if (!res.ok) throw new Error("Failed to load history")
      return res.json()
    },
  })

  const [view, setView] = useState<ViewMode>("list")
  const deleteRun = useDeleteRun()

  const hasActive = runs.some((r) => r.status === "pending" || r.status === "in_progress")
  useEffect(() => {
    if (!hasActive) return
    const timer = setInterval(() => {
      refetch()
    }, 5_000)
    return () => clearInterval(timer)
  }, [hasActive, refetch])

  if (isLoading) {
    return (
      <div className="bg-white border border-gray-200 divide-y divide-gray-100">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="px-5 py-4 flex items-start gap-3 animate-pulse">
            <div className="w-2 h-2 rounded-full bg-gray-200 mt-[5px] shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-200 rounded w-48" />
              <div className="h-3 bg-gray-100 rounded w-64" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-5 py-4 bg-red-50 border border-red-200 text-sm text-red-700">
        {error instanceof Error ? error.message : "Failed to load history"}
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          {runs.length} {runs.length === 1 ? "generation" : "generations"}
        </span>
        <div className="flex items-center gap-2">
          {/* View toggle — desktop only */}
          <div className="hidden md:flex items-center gap-0.5 border border-gray-200 rounded p-0.5">
            <button
              onClick={() => setView("list")}
              className={`p-1 rounded transition-colors ${view === "list" ? "bg-zinc-900 text-white" : "text-zinc-400 hover:text-zinc-700"}`}
              aria-label="List view"
            >
              <LayoutList size={14} />
            </button>
            <button
              onClick={() => setView("grid")}
              className={`p-1 rounded transition-colors ${view === "grid" ? "bg-zinc-900 text-white" : "text-zinc-400 hover:text-zinc-700"}`}
              aria-label="Grid view"
            >
              <LayoutGrid size={14} />
            </button>
          </div>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-black transition-colors py-1 px-2 rounded hover:bg-zinc-50"
          >
            <RefreshCw size={11} />
            Refresh
          </button>
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <p className="text-sm font-semibold text-zinc-400">No generations yet</p>
          <p className="text-xs text-zinc-300 mt-1">Your tailored resumes will appear here</p>
        </div>
      ) : view === "grid" ? (
        /* ── Grid view ── */
        <div className="p-4 grid grid-cols-2 lg:grid-cols-3 gap-4">
          {runs.map((run) => (
            run.status === "in_progress" || run.status === "pending" ? (
              <LiveProgressGridCard key={run.id} run={run} onDelete={deleteRun} refetch={refetch} />
            ) : (
              <GridCard key={run.id} run={run} onDelete={deleteRun} />
            )
          ))}
        </div>
      ) : (
        /* ── List view ── */
        <div className="divide-y divide-gray-100">
          {runs.map((run) => {
            if (run.status === "in_progress" || run.status === "pending") {
              return (
                <LiveProgressRow
                  key={run.id}
                  run={run}
                  onDelete={deleteRun}
                  refetch={refetch}
                />
              )
            }

            const date = new Date(run.created_at).toLocaleDateString("en-US", {
              month: "short", day: "numeric", year: "numeric",
            })
            const completed = run.status === "completed"
            const failed = run.status === "failed"

            return (
              <div
                key={run.id}
                onClick={() => completed && window.open(`/api/backend/generate/${run.id}/download`, "_blank")}
                className={[
                  "flex items-center justify-between gap-4 px-5 py-3.5 transition-all duration-150 group",
                  completed
                    ? "cursor-pointer hover:bg-[#ff4e26] hover:[&_.title-span]:text-white hover:[&_.at-span]:text-zinc-200 hover:[&_.date-p]:text-zinc-200 hover:[&_.dot-span]:text-zinc-200 hover:[&_.delete-btn]:text-zinc-200 hover:scale-[1.012] hover:shadow-sm hover:z-10 hover:relative"
                    : failed
                    ? "hover:bg-zinc-50"
                    : "",
                ].join(" ")}
              >
                {/* Left: dot + info */}
                <div className="flex items-start gap-3 min-w-0">
                  <StatusDot status={run.status} />
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className={`title-span text-sm font-semibold leading-snug transition-colors duration-150 ${failed ? "text-zinc-400 line-through" : "text-zinc-900"}`}>
                        {run.job_title || "Tailored Resume"}
                      </span>
                      {run.company && (
                        <span className="at-span text-sm text-zinc-400 font-normal truncate transition-colors duration-150">
                          at {run.company}
                        </span>
                      )}
                    </div>
                    <p className="date-p text-xs text-zinc-400 mt-0.5 transition-colors duration-150">
                      {date}
                      <span className="dot-span mx-1.5 text-zinc-300 transition-colors duration-150">·</span>
                      {run.template_id}
                      <span className="dot-span mx-1.5 text-zinc-300 transition-colors duration-150">·</span>
                      {run.model_used}
                      {failed && (
                        <><span className="dot-span mx-1.5 text-zinc-300 transition-colors duration-150">·</span><span className="text-red-400 font-medium">Failed</span></>
                      )}
                    </p>
                  </div>
                </div>

                {/* Right: delete */}
                <button
                  onClick={(e) => { e.stopPropagation(); deleteRun(run.id) }}
                  className="delete-btn shrink-0 p-1.5 text-zinc-300 hover:!text-white rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                  aria-label="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
