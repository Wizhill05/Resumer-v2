"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState, useEffect, useRef } from "react"
import { RefreshCw, LayoutList, LayoutGrid, Trash2, FileText, Pencil, X, Copy } from "lucide-react"
import { createPortal } from "react-dom"
import { FeedbackModal } from "@/components/FeedbackModal"

type HistoryRun = {
  id: string
  job_title?: string
  company?: string
  status: string
  created_at: string
  template_id: string
  model_used: string
  job_description: string
  thumb_storage_key?: string
}

const nodeProgressMap: Record<string, number> = {
  job_analysis: 10,
  selection: 18,
  summary_skills: 26,
  experience_writer: 34,
  projects_writer: 42,
  extracurricular_writer: 50,
  assembly: 58,
  renderer: 68,
  orphan_repair: 76,
  content_reduction: 84,
  saver: 95,
}

const nodeLabels: Record<string, string> = {
  job_analysis: "Analyzing job post",
  selection: "Selecting content",
  summary_skills: "Writing summary & skills",
  experience_writer: "Writing experience",
  projects_writer: "Writing projects",
  extracurricular_writer: "Writing extracurriculars",
  assembly: "Assembling resume",
  renderer: "Rendering PDF",
  orphan_repair: "Fixing layout issues",
  content_reduction: "Optimizing fit",
  saver: "Saving files",
}

function useLiveProgress(runId: string, enabled: boolean, onDone: () => void) {
  const [percent, setPercent] = useState(10)
  const [stepLabel, setStepLabel] = useState("Starting")
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
            const label = nodeLabels[log.node]
            if (label) setStepLabel(label)
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

  return { percent, stepLabel }
}

type ViewMode = "list" | "grid"

function StatusDot({ status }: { status: string }) {
  if (status === "completed")
    return <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 shrink-0 mt-[5px]" />
  if (status === "failed")
    return <span className="inline-block w-2 h-2 rounded-full bg-red-400 shrink-0 mt-[5px]" />
  return <span className="inline-block w-2 h-2 rounded-full bg-amber-400 shrink-0 mt-[5px]" />
}

function JobDescriptionPeek({ text }: { text: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false)
    }
    window.addEventListener("keydown", handler)
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", handler)
      document.body.style.overflow = ""
    }
  }, [isOpen])

  const copy = async (event: React.MouseEvent) => {
    event.stopPropagation()
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setIsOpen(true)
        }}
        className="inline-flex cursor-pointer items-center text-[11px] font-semibold text-zinc-500 hover:text-black dark:text-zinc-400 dark:hover:text-white underline underline-offset-2 transition-colors"
      >
        See job description
      </button>
      {isOpen && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-label="Job Description"
          onClick={(e) => {
            e.stopPropagation()
            setIsOpen(false)
          }}
        >
          <div
            className="relative z-10 flex max-h-[85vh] w-full max-w-xl flex-col border-3 border-black dark:border-zinc-600 bg-white dark:bg-zinc-900 shadow-[8px_8px_0_#000] dark:shadow-[8px_8px_0_#3f3f46] transition-all"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-700 px-4 py-3">
              <span className="text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
                Job Description
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={copy}
                  className="flex min-h-9 cursor-pointer touch-manipulation items-center gap-1 border border-zinc-200 dark:border-zinc-600 px-2 py-1 text-[10px] font-bold uppercase dark:text-zinc-300 active:border-zinc-900 active:bg-zinc-100 dark:active:bg-zinc-700 sm:hover:border-zinc-900 dark:sm:hover:border-zinc-400 sm:hover:bg-zinc-50 dark:sm:hover:bg-zinc-800"
                >
                  <Copy size={12} />
                  {copied ? "Copied!" : "Copy"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="flex min-h-9 min-w-9 cursor-pointer touch-manipulation items-center justify-center border border-zinc-200 dark:border-zinc-600 p-1 dark:text-zinc-300 active:border-zinc-900 active:bg-zinc-100 dark:active:bg-zinc-700 sm:hover:border-zinc-900 dark:sm:hover:border-zinc-400 sm:hover:bg-zinc-50 dark:sm:hover:bg-zinc-800"
                  aria-label="Close modal"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap select-text">
              {text || "No job description text available."}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
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
  const { percent, stepLabel } = useLiveProgress(run.id, true, refetch)
  const date = new Date(run.created_at).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  })

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5 transition-all duration-150 group bg-zinc-50/50 dark:bg-zinc-800/50">
      {/* Left: dot + info */}
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <StatusDot status="in_progress" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-semibold leading-snug text-zinc-900 dark:text-zinc-100">
              {run.job_title || "Tailored Resume"}
            </span>
            {run.company && (
              <span className="text-sm text-zinc-400 dark:text-zinc-500 font-normal truncate">
                at {run.company}
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
            {date}
            <span className="mx-1.5 text-zinc-300 dark:text-zinc-600">·</span>
            {run.template_id}
            <span className="mx-1.5 text-zinc-300 dark:text-zinc-600">·</span>
            <span className="text-amber-500 font-medium">{stepLabel} ({percent}%)</span>
          </p>
          <div className="mt-2"><JobDescriptionPeek text={run.job_description} /></div>
          
          {/* Progress bar */}
          <div className="w-full bg-zinc-100 dark:bg-zinc-700 h-1 mt-2 rounded-full overflow-hidden">
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
        className="shrink-0 rounded p-1.5 text-zinc-400 transition-colors active:text-red-500 md:text-zinc-300 md:hover:text-red-500 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
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
  const { percent, stepLabel } = useLiveProgress(run.id, true, refetch)
  const date = new Date(run.created_at).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  })

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 overflow-hidden flex flex-col group hover:border-gray-400 dark:hover:border-zinc-500 transition-colors">
      {/* Thumbnail placeholder with progress */}
      <div className="relative border-b border-gray-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800" style={{ aspectRatio: "210/297" }}>
        <div className="w-full h-full flex flex-col items-center justify-center p-4 gap-3">
          <FileText size={28} className="text-zinc-300 dark:text-zinc-600" />
          <span className="text-xs text-amber-500 font-medium">{stepLabel}… {percent}%</span>
          
          {/* Progress bar */}
          <div className="w-2/3 bg-zinc-200 dark:bg-zinc-700 h-1 rounded-full overflow-hidden">
            <div
              className="bg-[#ff4e26] h-full transition-all duration-500 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        {/* Delete overlay button */}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(run.id) }}
          className="absolute top-2 right-2 rounded border border-gray-200 dark:border-zinc-600 bg-white/90 dark:bg-zinc-800/90 p-1.5 text-zinc-500 transition-colors active:border-red-300 active:text-red-500 md:text-zinc-400 md:hover:border-red-300 md:hover:text-red-500 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
          aria-label="Delete"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Footer */}
      <div className="px-3 py-3">
        <div className="flex items-start gap-1.5">
          <StatusDot status="in_progress" />
          <span className="text-sm font-semibold leading-snug truncate text-zinc-900 dark:text-zinc-100">
            {run.job_title || "Tailored Resume"}
          </span>
        </div>
        <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5 truncate pl-3.5">
          {run.company ? `${run.company} · ` : ""}{date}
        </p>
        <div className="mt-2 pl-3.5"><JobDescriptionPeek text={run.job_description} /></div>
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
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 overflow-hidden flex flex-col group hover:border-gray-400 dark:hover:border-zinc-500 transition-colors">
      {/* Thumbnail */}
      <div
        className={`relative border-b border-gray-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 ${completed ? "cursor-pointer" : ""}`}
        style={{ aspectRatio: "210/297" }}
        onClick={() => completed && (window.location.href = `/api/backend/generate/${run.id}/download`)}
      >
        {completed && run.thumb_storage_key ? (
          <img
            src={`/api/backend/generate/${run.id}/thumb`}
            alt={`${run.job_title || "Resume"} preview`}
            className="w-full h-full object-cover object-top dark:invert dark:hue-rotate-180"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2">
            <FileText size={28} className="text-zinc-300 dark:text-zinc-600" />
            {failed && <span className="text-xs text-red-400 font-medium">Failed</span>}
            {!completed && !failed && (
              <span className="text-xs text-amber-500 font-medium">Processing…</span>
            )}
          </div>
        )}

        {/* Delete overlay button */}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(run.id) }}
          className="absolute top-2 right-2 rounded border border-gray-200 dark:border-zinc-600 bg-white/90 dark:bg-zinc-800/90 p-1.5 text-zinc-500 transition-colors active:border-red-300 active:text-red-500 md:text-zinc-400 md:hover:border-red-300 md:hover:text-red-500 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
          aria-label="Delete"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Footer */}
      <div
        className={`px-3 py-3 cursor-pointer transition-all duration-150 ${completed ? "hover:bg-[#ff4e26] hover:[&_.title-span]:text-white hover:[&_.date-p]:text-zinc-200" : ""}`}
        onClick={() => completed && (window.location.href = `/api/backend/generate/${run.id}/download`)}
      >
        <div className="flex items-start gap-1.5">
          <StatusDot status={run.status} />
          <span className={`title-span text-sm font-semibold leading-snug truncate transition-colors duration-150 ${failed ? "text-zinc-400 line-through" : "text-zinc-900 dark:text-zinc-100"}`}>
            {run.job_title || "Tailored Resume"}
          </span>
          {completed && (
            <button
              onClick={(e) => { e.stopPropagation(); window.location.href = `/dashboard/history/${run.id}/edit` }}
              className="ml-auto shrink-0 flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 hover:border-zinc-400 rounded transition-colors"
              aria-label="Edit resume"
            >
              <Pencil size={11} />
              Edit
            </button>
          )}
        </div>
        <p className="date-p text-xs text-zinc-400 dark:text-zinc-500 mt-0.5 truncate pl-3.5 transition-colors duration-150">
          {run.company ? `${run.company} · ` : ""}{date}
        </p>
      </div>
    </div>
  )
}

export function HistoryClient() {
  const queryClient = useQueryClient()
  const { data: runs = [], isLoading, isFetching, error, refetch } = useQuery<HistoryRun[]>({
    queryKey: ["history"],
    queryFn: async () => {
      const res = await fetch("/api/backend/generate")
      if (!res.ok) throw new Error("Failed to load history")
      return res.json()
    },
  })
  const [view, setView] = useState<ViewMode>("list")
  const [activeGenForFeedback, setActiveGenForFeedback] = useState<string | null>(null)
  const deleteRun = useDeleteRun()

  const hasActive = runs.some((r) => r.status === "pending" || r.status === "in_progress")
  useEffect(() => {
    if (!hasActive) return
    const timer = setInterval(() => {
      refetch()
    }, 5_000)
    return () => clearInterval(timer)
  }, [hasActive, refetch])

  // Check if post-generation rating modal should pop up
  useEffect(() => {
    try {
      if (localStorage.getItem("resumer_feedback_prompted") === "true") return
    } catch {}

    if (runs.length > 0) {
      const completedRun = runs.find((r) => r.status === "completed")
      if (completedRun) {
        fetch(`/api/backend/feedback/rating/check?generation_id=${completedRun.id}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data?.should_prompt) {
              setActiveGenForFeedback(completedRun.id)
            }
          })
          .catch(() => {})
      }
    }
  }, [runs])

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 divide-y divide-gray-100 dark:divide-zinc-800">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="px-5 py-4 flex items-start gap-3">
            <div className="w-2 h-2 rounded-full bg-gray-200 dark:bg-zinc-700 mt-[5px] shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-200 dark:bg-zinc-700 rounded w-48 animate-pulse" />
              <div className="h-3 bg-gray-100 dark:bg-zinc-800 rounded w-64 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-5 py-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400">
        {error instanceof Error ? error.message : "Failed to load history"}
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 pixel-enter">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-zinc-800">
        <span className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
          {runs.length} {runs.length === 1 ? "generation" : "generations"}
        </span>
        <div className="flex items-center gap-2">
          {/* View toggle — desktop only */}
          <div className="hidden md:flex items-center gap-0.5 border border-gray-200 dark:border-zinc-700 rounded p-0.5">
            <button
              onClick={() => setView("list")}
              className={`p-1 rounded transition-colors ${view === "list" ? "bg-zinc-900 dark:bg-zinc-200 text-white dark:text-zinc-900" : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
              aria-label="List view"
            >
              <LayoutList size={14} />
            </button>
            <button
              onClick={() => setView("grid")}
              className={`p-1 rounded transition-colors ${view === "grid" ? "bg-zinc-900 dark:bg-zinc-200 text-white dark:text-zinc-900" : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
              aria-label="Grid view"
            >
              <LayoutGrid size={14} />
            </button>
          </div>
          <button
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["history"] })
              refetch()
            }}
            disabled={isFetching}
            className="flex items-center gap-1.5 text-xs font-semibold text-zinc-600 hover:text-black dark:text-zinc-300 dark:hover:text-white transition-colors py-1 px-2.5 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 cursor-pointer"
          >
            <RefreshCw size={12} className={isFetching ? "animate-spin text-[#ff4e26]" : ""} />
            <span>{isFetching ? "Refreshing..." : "Refresh"}</span>
          </button>
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <p className="text-sm font-semibold text-zinc-400 dark:text-zinc-500">No generations yet</p>
          <p className="text-xs text-zinc-300 dark:text-zinc-600 mt-1">Your tailored resumes will appear here</p>
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
        <div className="divide-y divide-gray-100 dark:divide-zinc-800">
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
                onClick={() => completed && (window.location.href = `/api/backend/generate/${run.id}/download`)}
                className={[
                  "flex items-center justify-between gap-3 px-3.5 py-3 md:px-5 md:py-3.5 transition-all duration-150 group",
                  completed
                    ? "cursor-pointer hover:bg-[#ff4e26] hover:[&_.title-span]:text-white hover:[&_.at-span]:text-zinc-200 hover:[&_.date-p]:text-zinc-200 hover:[&_.dot-span]:text-zinc-200 hover:[&_.delete-btn]:text-zinc-200 md:hover:scale-[1.012] md:hover:shadow-sm md:hover:z-10 md:hover:relative"
                    : failed
                    ? "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                    : "",
                ].join(" ")}
              >
                {/* Left: dot + info */}
                <div className="flex items-start gap-2.5 min-w-0 md:gap-3">
                  <StatusDot status={run.status} />
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-1.5 flex-wrap md:gap-2">
                      <span className={`title-span text-xs font-extrabold uppercase tracking-tight md:text-sm transition-colors duration-150 ${failed ? "text-zinc-400 line-through" : "text-zinc-900 dark:text-zinc-100"}`}>
                        {run.job_title || "Tailored Resume"}
                      </span>
                      {run.company && (
                        <span className="at-span text-xs text-zinc-400 dark:text-zinc-500 font-semibold truncate transition-colors duration-150">
                          at {run.company}
                        </span>
                      )}
                    </div>
                    <p className="date-p text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5 transition-colors duration-150">
                      {date}
                      <span className="dot-span mx-1 text-zinc-300 dark:text-zinc-600 transition-colors duration-150">·</span>
                      {run.template_id}
                      {failed && (
                        <><span className="dot-span mx-1 text-zinc-300 dark:text-zinc-600 transition-colors duration-150">·</span><span className="text-red-400 font-medium">Failed</span></>
                      )}
                    </p>
                    <div className="mt-1.5"><JobDescriptionPeek text={run.job_description} /></div>
                  </div>
                </div>

                {/* Right: edit + delete */}
                <div className="flex items-center gap-1 shrink-0">
                  {completed && (
                    <button
                      onClick={(e) => { e.stopPropagation(); window.location.href = `/dashboard/history/${run.id}/edit` }}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 hover:border-zinc-400 hover:!text-zinc-800 dark:hover:!text-white rounded transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100 cursor-pointer"
                      aria-label="Edit"
                    >
                      <Pencil size={13} />
                      <span className="hidden sm:inline">Edit</span>
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteRun(run.id) }}
                    className="delete-btn shrink-0 p-2 text-zinc-400 hover:text-red-600 md:text-zinc-300 md:hover:!text-white rounded transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100 cursor-pointer"
                    aria-label="Delete"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {activeGenForFeedback && (
        <FeedbackModal
          generationId={activeGenForFeedback}
          onClose={() => setActiveGenForFeedback(null)}
        />
      )}
    </div>
  )
}
