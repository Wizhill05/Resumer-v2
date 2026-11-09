"use client"

import { captureDownload } from "@/lib/posthog"

import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query"
import { useState, useEffect, useRef, useMemo } from "react"
import { RefreshCw, LayoutList, LayoutGrid, Trash2, FileText, Pencil, X, Copy, Eye, Download, ArrowLeft, Loader2, Bug, Search } from "lucide-react"
import {
  fetchHistoryPage,
  HISTORY_LIST_KEY,
  HISTORY_SUMMARY_KEY,
  type HistoryPage,
  type HistoryRun,
} from "@/lib/history"
import { createPortal } from "react-dom"
import { PdfViewer } from "@/components/pdf/PdfViewer"
import { downloadResumePdf, forgetResumePdf, getResumePdf, saveBlob, type ResumePdf } from "@/lib/resume-pdf-cache"
import { FeedbackModal } from "@/components/FeedbackModal"
import { ReportIssueButton } from "@/components/support/ReportIssueButton"


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
  replace_project_start: 15,
  replace_project: 35,
  render_pdf: 88,
}

const nodeLabels: Record<string, string> = {
  job_analysis: "Analyzing job post",
  selection: "Selecting content",
  summary_skills: "Writing summary & skills",
  experience_writer: "Writing experience",
  projects_writer: "Writing projects",
  extracurricular_writer: "Writing extracurriculars",
  assembly: "Assembling résumé",
  renderer: "Rendering PDF",
  orphan_repair: "Fixing layout issues",
  content_reduction: "Optimizing fit",
  saver: "Saving files",
  replace_project_start: "Remaking project",
  replace_project: "Remaking project",
  render_pdf: "Rendering updated PDF",
}

function useLiveProgress(runId: string, enabled: boolean, onDone: () => void, initialStatus?: string) {
  const isRemake = initialStatus === "remaking_project"
  const [percent, setPercent] = useState(isRemake ? 15 : 10)
  const [stepLabel, setStepLabel] = useState(isRemake ? "Remaking project" : "Starting")
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

function JobDescriptionPeek({ runId }: { runId: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  // The list payload omits the (large) job description; load it when the
  // modal is first opened. It never changes after creation, so cache it.
  const { data: text, isPending, isError, refetch } = useQuery<string>({
    queryKey: ["generation-job-description", runId],
    queryFn: async () => {
      const res = await fetch(`/api/backend/generate/${runId}`)
      if (!res.ok) throw new Error("Failed to load job description")
      const gen = (await res.json()) as { job_description?: string }
      return gen.job_description ?? ""
    },
    enabled: isOpen,
    staleTime: Infinity,
  })

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
    if (text === undefined) return
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
        className="inline-flex cursor-pointer items-center text-[11px] font-semibold text-ink-muted hover:text-ink dark:hover:text-white underline underline-offset-2 transition-colors"
      >
        See job description
      </button>
      {isOpen && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(35_10_4/38%)] dark:bg-black/60 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-label="Job Description"
          onClick={(e) => {
            e.stopPropagation()
            setIsOpen(false)
          }}
        >
          <div
            className="relative z-10 flex max-h-[85vh] w-full max-w-xl flex-col rounded-lg border border-line bg-paper shadow-soft-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="text-sm font-semibold text-ink">
                Job Description
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={copy}
                  disabled={text === undefined}
                  className="flex min-h-9 cursor-pointer touch-manipulation items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs font-semibold text-ink-soft transition-colors active:bg-ink/5 sm:hover:border-ember/50 sm:hover:text-ember"
                >
                  <Copy size={12} />
                  {copied ? "Copied!" : "Copy"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="flex min-h-9 min-w-9 cursor-pointer touch-manipulation items-center justify-center rounded-md border border-line p-1 text-ink-muted transition-colors active:bg-ink/5 sm:hover:border-ember/50 sm:hover:text-ember"
                  aria-label="Close modal"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4 text-[11px] leading-relaxed text-ink whitespace-pre-wrap select-text">
              {isPending
                ? "Loading…"
                : isError
                ? (
                  <>
                    Couldn&apos;t load the job description.{" "}
                    <button type="button" onClick={() => void refetch()} className="underline">
                      Retry
                    </button>
                  </>
                )
                : text || "No job description text available."}
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
    if (!window.confirm("Delete this résumé from history?")) return
    await fetch(`/api/backend/generate/${id}`, { method: "DELETE" })
    void forgetResumePdf(id)
    // Drop the row from every cached search/page and keep the counts honest,
    // without refetching all loaded pages.
    queryClient.setQueriesData<InfiniteData<HistoryPage, string | null>>(
      { queryKey: HISTORY_LIST_KEY },
      (old) => {
        if (!old || !old.pages.some((page) => page.items.some((r) => r.id === id))) return old
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.filter((r) => r.id !== id),
            total: page.total - 1,
            unfiltered_total: page.unfiltered_total - 1,
          })),
        }
      }
    )
    void queryClient.invalidateQueries({ queryKey: HISTORY_SUMMARY_KEY })
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
  const { percent, stepLabel } = useLiveProgress(run.id, true, refetch, run.status)
  const date = new Date(run.created_at).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  })

  return (
    <div
      onClick={() => {
        if (run.status === "remaking_project") {
          window.location.href = `/dashboard/history/${run.id}/remake`
        }
      }}
      className={`flex items-center justify-between gap-4 px-5 py-3.5 transition-all duration-150 group bg-ink/[0.03] ${
        run.status === "remaking_project" ? "cursor-pointer hover:bg-ink/5 dark:hover:bg-ink/[0.06]" : ""
      }`}
    >
      {/* Left: dot + info */}
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <StatusDot status="in_progress" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-semibold leading-snug text-ink">
              {run.job_title || "Tailored Résumé"}
            </span>
            {run.company && (
              <span className="text-sm text-ink-faint font-normal truncate">
                at {run.company}
              </span>
            )}
          </div>
          <p className="text-xs text-ink-faint mt-0.5">
            {date}
            <span className="mx-1.5 text-ink-faint">·</span>
            {run.template_id}
            <span className="mx-1.5 text-ink-faint">·</span>
            <span className="text-amber-500 font-medium">{stepLabel} ({percent}%)</span>
          </p>
          <div className="mt-2"><JobDescriptionPeek runId={run.id} /></div>
          
          {/* Progress bar */}
          <div className="w-full bg-ink/5 h-1 mt-2 rounded-full overflow-hidden">
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
        className="shrink-0 rounded p-1.5 text-ink-faint transition-colors active:text-red-500 md:text-ink-faint md:hover:text-red-500 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
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
  const { percent, stepLabel } = useLiveProgress(run.id, true, refetch, run.status)
  const date = new Date(run.created_at).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  })

  return (
    <div
      onClick={() => {
        if (run.status === "remaking_project") {
          window.location.href = `/dashboard/history/${run.id}/remake`
        }
      }}
      className={`bg-paper border border-line overflow-hidden flex flex-col group hover:border-gray-400 dark:hover:border-ember/50 transition-colors rounded-md ${
        run.status === "remaking_project" ? "cursor-pointer" : ""
      }`}
    >
      {/* Thumbnail placeholder with progress */}
      <div className="relative border-b border-line bg-ink/[0.03]" style={{ aspectRatio: "210/297" }}>
        <div className="w-full h-full flex flex-col items-center justify-center p-4 gap-3">
          <FileText size={28} className="text-ink-faint" />
          <span className="text-xs text-amber-500 font-medium">{stepLabel}… {percent}%</span>
          
          {/* Progress bar */}
          <div className="w-2/3 bg-ink/10 h-1 rounded-full overflow-hidden">
            <div
              className="bg-[#ff4e26] h-full transition-all duration-500 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        {/* Delete overlay button */}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(run.id) }}
          className="absolute top-2 right-2 rounded border border-line bg-paper/90 p-1.5 text-ink-muted transition-colors active:border-red-300 active:text-red-500 md:text-ink-faint md:hover:border-red-300 md:hover:text-red-500 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
          aria-label="Delete"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Footer */}
      <div className="px-3 py-3">
        <div className="flex items-start gap-1.5">
          <StatusDot status="in_progress" />
          <span className="text-sm font-semibold leading-snug truncate text-ink">
            {run.job_title || "Tailored Résumé"}
          </span>
        </div>
        <p className="text-xs text-ink-faint mt-0.5 truncate pl-3.5">
          {run.company ? `${run.company} · ` : ""}{date}
        </p>
        <div className="mt-2 pl-3.5"><JobDescriptionPeek runId={run.id} /></div>
      </div>
    </div>
  )
}

function FullscreenResumeOverlay({
  run,
  onClose,
}: {
  run: HistoryRun
  onClose: () => void
}) {
  const [attempt, setAttempt] = useState(0)
  const version = run.pdf_version ?? 0
  const loadKey = `${run.id}:${version}:${attempt}`
  const [loaded, setLoaded] = useState<{ key: string; pdf?: ResumePdf; error?: string } | null>(null)
  const pdf = loaded?.key === loadKey ? loaded.pdf ?? null : null
  const error = loaded?.key === loadKey ? loaded.error ?? null : null
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    document.body.style.overflow = "hidden"
    closeRef.current?.focus()
    return () => {
      window.removeEventListener("keydown", handler)
      document.body.style.overflow = ""
    }
  }, [onClose])

  // Fetch the real PDF once; it is kept on the device so Download is instant.
  useEffect(() => {
    let active = true
    getResumePdf(run.id, version)
      .then((result) => { if (active) setLoaded({ key: loadKey, pdf: result }) })
      .catch((err) => {
        if (active) setLoaded({ key: loadKey, error: err instanceof Error ? err.message : "Could not load the PDF" })
      })
    return () => { active = false }
  }, [run.id, version, loadKey])

  const download = () => {
    captureDownload(run.id, "history")
    if (pdf) saveBlob(pdf)
    else void downloadResumePdf(run.id, version)
  }

  const date = new Date(run.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  const title = run.job_title || "Tailored Résumé"

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-app/95 backdrop-blur-md text-ink animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={`${title} preview`}
    >
      {/* Top Action Header Bar */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-paper/75 px-3 py-2 backdrop-blur-xl sm:px-4 sm:py-3 md:px-6">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-md border border-line bg-paper/80 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-ember/50 hover:text-ember cursor-pointer"
            title="Back to History (Esc)"
          >
            <ArrowLeft size={14} />
            <span className="hidden sm:inline">Back</span>
          </button>
          <div className="min-w-0">
            <h3 className="text-xs sm:text-sm font-bold tracking-tight truncate text-ink">
              {title}
            </h3>
            <p className="text-[11px] font-medium text-ink-muted truncate">
              {run.company ? `${run.company} • ` : ""}{date} • {run.template_id}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            onClick={() => {
              window.location.href = `/dashboard/history/${run.id}/edit`
            }}
            className="flex items-center gap-1.5 rounded-md border border-line bg-paper/80 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-ember/50 hover:text-ember cursor-pointer"
          >
            <Pencil size={13} />
            <span>Edit</span>
          </button>
          <button
            onClick={download}
            className="flex items-center gap-1.5 rounded-md px-2.5 sm:px-3 py-1.5 text-xs font-semibold bg-ember hover:bg-[#e03d16] text-white transition-colors cursor-pointer shadow-[0_8px_20px_-10px_rgb(255_78_38/70%)]"
            aria-label="Download PDF"
          >
            <Download size={13} />
            <span className="hidden sm:inline">Download PDF</span>
          </button>
          <button
            ref={closeRef}
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-md text-ink-muted hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
            aria-label="Close preview"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* PDF canvas: scroll / pinch to zoom, drag to move */}
      <div className="relative min-h-0 flex-1">
        {pdf ? (
          <PdfViewer key={loadKey} data={pdf.blob} title={title} />
        ) : error ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="soft-card flex max-w-sm flex-col items-center gap-4 p-6 text-center" role="alert">
              <FileText size={48} className="text-ink-muted" />
              <p className="text-sm font-medium text-ink-muted">{error}</p>
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  onClick={() => setAttempt((n) => n + 1)}
                  className="flex items-center gap-2 rounded-md border border-line bg-paper px-4 py-2 text-xs font-semibold text-ink transition-colors hover:border-ember/50 cursor-pointer"
                >
                  <RefreshCw size={14} /> Try again
                </button>
                <button
                  onClick={download}
                  className="flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold bg-ember hover:bg-[#e03d16] text-white transition-colors cursor-pointer"
                >
                  <Download size={14} /> Download PDF
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-muted">
            <Loader2 className="animate-spin text-ember" size={32} />
            <span className="text-xs" role="status">Loading PDF…</span>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

function GridCard({ run, onDelete, onPreview }: { run: HistoryRun; onDelete: (id: string) => void; onPreview?: (run: HistoryRun) => void }) {
  const date = new Date(run.created_at).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  })
  const completed = run.status === "completed"
  const failed = run.status === "failed"

  return (
    <div className="soft-card soft-hover group flex flex-col overflow-hidden">
      {/* Thumbnail */}
      <div
        className={`relative border-b border-line bg-ink/[0.03] ${completed ? "cursor-pointer" : ""}`}
        style={{ aspectRatio: "210/297" }}
        onClick={() => completed && onPreview ? onPreview(run) : (completed && void downloadResumePdf(run.id, run.pdf_version ?? 0))}
      >
        {completed && run.thumb_storage_key ? (
          <img
            src={`/api/backend/generate/${run.id}/thumb`}
            alt={`${run.job_title || "Résumé"} preview`}
            className="w-full h-full object-cover object-top dark:invert dark:hue-rotate-180"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2">
            <FileText size={28} className="text-ink-faint" />
            {failed && <span className="text-xs text-red-400 font-medium">Failed</span>}
            {!completed && !failed && (
              <span className="text-xs text-amber-500 font-medium">Processing…</span>
            )}
          </div>
        )}
        {/* Delete overlay button */}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(run.id) }}
          className="absolute top-2 right-2 rounded border border-line bg-paper/90 p-1.5 text-ink-muted transition-colors active:border-red-300 active:text-red-500 md:text-ink-faint md:hover:border-red-300 md:hover:text-red-500 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
          aria-label="Delete"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Footer */}
      <div
        className={`px-3 py-3 ${completed ? "cursor-pointer hover:bg-ember-tint/50 hover:[&_.title-span]:text-ember" : ""} transition-all duration-150`}
        onClick={() => completed && void downloadResumePdf(run.id, run.pdf_version ?? 0)}
      >
        <div className="flex items-start gap-1.5">
          <StatusDot status={run.status} />
          <span className={`title-span text-sm font-semibold leading-snug truncate transition-colors duration-150 ${failed ? "text-ink-faint line-through" : "text-ink"}`}>
            {run.job_title || "Tailored Résumé"}
          </span>
          {completed && (
            <button
              onClick={(e) => { e.stopPropagation(); window.location.href = `/dashboard/history/${run.id}/edit` }}
              className="ml-auto shrink-0 flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium border border-line text-ink-muted bg-paper hover:border-ink/30 rounded-md transition-colors"
              aria-label="Edit résumé"
            >
              <Pencil size={11} />
              Edit
            </button>
          )}
          {failed && (
            <span onClick={(e) => e.stopPropagation()} className="ml-auto shrink-0" >
              <ReportIssueButton
                defaultCategory="generation"
                defaultMessage={`[Generation failed]\nRun ID: ${run.id}\nTemplate: ${run.template_id}\nCreated: ${run.created_at}\nTitle: ${run.job_title || "Untailored"}\n\nDescribe what job description you used and what you expected:\n`}
                generationId={run.id}
                title="Report failed generation"
                description="Run ID is prefilled. Add what you pasted as job description."
                variant="outline"
                size="xs"
                className="h-6 px-2 text-[10px] font-bold border-red-300 text-red-600 hover:bg-red-50"
              >
                Report
              </ReportIssueButton>
            </span>
          )}
        </div>
        <p className="date-p text-xs text-ink-faint mt-0.5 truncate pl-3.5 transition-colors duration-150">
          {run.company ? `${run.company} · ` : ""}{date}
        </p>
        {failed && (
          <div className="mt-2 pl-3.5">
            <p className="text-[11px] font-medium text-red-500 dark:text-red-400">Generation failed — tap Report to send logs-backed feedback.</p>
          </div>
        )}
      </div>
    </div>
  )
}

export function HistoryClient() {
  const queryClient = useQueryClient()
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const trimmedQuery = searchQuery.trim()

  // Search runs on the server (the list is paginated, so the client no longer
  // holds every run). Debounce typing; clearing applies on the next tick.
  const [appliedQuery, setAppliedQuery] = useState("")
  useEffect(() => {
    const timer = setTimeout(() => setAppliedQuery(trimmedQuery), trimmedQuery ? 250 : 0)
    return () => clearTimeout(timer)
  }, [trimmedQuery])

  const {
    data,
    isLoading,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error,
    refetch,
  } = useInfiniteQuery({
    queryKey: [...HISTORY_LIST_KEY, appliedQuery],
    queryFn: ({ pageParam }) => fetchHistoryPage(appliedQuery, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    // Keep the old rows on screen while a new search is in flight.
    placeholderData: keepPreviousData,
  })
  const runs = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data])
  const lastPage = data?.pages[data.pages.length - 1]
  const total = lastPage?.total ?? 0
  const unfilteredTotal = lastPage?.unfiltered_total ?? 0

  const [view, setView] = useState<ViewMode>("list")
  const [activeGenForFeedback, setActiveGenForFeedback] = useState<string | null>(null)
  const [fullscreenRun, setFullscreenRun] = useState<HistoryRun | null>(null)
  const deleteRun = useDeleteRun()
  const clearSearch = () => {
    setSearchQuery("")
    searchRef.current?.focus()
  }

  // Infinite scroll: load the next page when the sentinel nears the viewport.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasNextPage || isFetchingNextPage) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void fetchNextPage()
      },
      { rootMargin: "350px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, runs.length, view])

  const remaining = Math.max(0, total - runs.length)
  const isRefreshing = isFetching && !isFetchingNextPage

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
      <div className="soft-card divide-y divide-line">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="px-5 py-4 flex items-start gap-3">
            <div className="w-2 h-2 rounded-full bg-ink/10 mt-[5px] shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-ink/10 rounded w-48 animate-pulse" />
              <div className="h-3 bg-ink/5 rounded w-64 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-5 py-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400 rounded-md">
        {error instanceof Error ? error.message : "Failed to load history"}
      </div>
    )
  }

  return (
    <div className="soft-card overflow-hidden pixel-enter">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-line">
        <span role="status" className="text-xs font-semibold text-ink-faint">
          {appliedQuery
            ? `${total} of ${unfilteredTotal} ${unfilteredTotal === 1 ? "generation" : "generations"}`
            : `${total} ${total === 1 ? "generation" : "generations"}`}
        </span>
        <div className="flex items-center gap-2">
          {/* View toggle — desktop only */}
          <div className="hidden md:flex items-center gap-0.5 rounded-md border border-line bg-ink/[0.04] p-0.5">
            <button
              onClick={() => setView("list")}
              className={`p-1 rounded transition-colors ${view === "list" ? "bg-paper text-ink shadow-soft" : "text-ink-faint hover:text-ink"}`}
              aria-label="List view"
            >
              <LayoutList size={14} />
            </button>
            <button
              onClick={() => setView("grid")}
              className={`p-1 rounded transition-colors ${view === "grid" ? "bg-paper text-ink shadow-soft" : "text-ink-faint hover:text-ink"}`}
              aria-label="Grid view"
            >
              <LayoutGrid size={14} />
            </button>
          </div>
          <button
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["history"] })
            }}
            disabled={isRefreshing}
            className="flex cursor-pointer items-center gap-1.5 rounded-md border border-line-strong bg-paper px-2.5 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-ink/30"
          >
            <RefreshCw size={12} className={isRefreshing ? "animate-spin text-[#ff4e26]" : ""} />
            <span>{isRefreshing ? "Refreshing..." : "Refresh"}</span>
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="border-b border-line p-3 sm:px-5 sm:py-3">
        <div className="relative">
          <Search
            size={15}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            ref={searchRef}
            type="text"
            role="searchbox"
            aria-label="Search generations by company or job role"
            placeholder="Search by company or job role..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && searchQuery) {
                setSearchQuery("")
              }
            }}
            className="h-10 w-full rounded-md border border-line-strong bg-paper pl-9 pr-9 text-sm text-ink placeholder:text-ink-faint transition-[border-color,box-shadow] focus:border-ember focus:outline-none focus:ring-3 focus:ring-ember/15"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-ink-faint hover:text-ink-muted dark:hover:text-ink cursor-pointer rounded"
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {runs.length === 0 && !appliedQuery && !trimmedQuery ? (
        <div className="px-5 py-16 text-center">
          <p className="text-sm font-semibold text-ink-faint">No generations yet</p>
          <p className="text-xs text-ink-faint mt-1">Your tailored résumés will appear here</p>
        </div>
      ) : runs.length === 0 ? (
        <div className="px-5 py-16 text-center space-y-3">
          <p className="text-sm font-semibold text-ink-muted">
            No generations match &ldquo;{appliedQuery || trimmedQuery}&rdquo;
          </p>
          <p className="text-xs text-ink-faint">
            Try searching for a different company name or job role
          </p>
          <div>
            <button
              type="button"
              onClick={clearSearch}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-[#ff4e26] hover:text-[#e03d16] border border-[#ff4e26]/30 hover:border-[#ff4e26] rounded transition-colors cursor-pointer bg-paper"
            >
              Clear search
            </button>
          </div>
        </div>
      ) : view === "grid" ? (
        /* ── Grid view ── */
        <>
          <div className="p-4 grid grid-cols-2 lg:grid-cols-3 gap-4">
            {runs.map((run) => (
              run.status === "in_progress" || run.status === "pending" || run.status === "remaking_project" ? (
                <LiveProgressGridCard key={run.id} run={run} onDelete={deleteRun} refetch={refetch} />
              ) : (
                <GridCard key={run.id} run={run} onDelete={deleteRun} onPreview={setFullscreenRun} />
              )
            ))}
          </div>
          {hasNextPage && (
            <div ref={sentinelRef} className="p-4 text-center border-t border-line bg-ink/[0.03]">
              <button
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
                className="cursor-pointer rounded-md border border-line-strong bg-paper px-4 py-2 text-xs font-semibold text-ink transition-colors hover:border-ink/30"
              >
                {isFetchingNextPage ? "Loading..." : `Load more (${remaining} remaining)`}
              </button>
            </div>
          )}
        </>
      ) : (
        /* ── List view ── */
        <>
          <div className="divide-y divide-line">
            {runs.map((run) => {
              if (run.status === "in_progress" || run.status === "pending" || run.status === "remaking_project") {
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
                  onClick={() => completed && void downloadResumePdf(run.id, run.pdf_version ?? 0)}
                  className={[
                    "flex items-center justify-between gap-3 px-3.5 py-3 md:px-5 md:py-3.5 transition-all duration-150 group",
                    completed
                      ? "cursor-pointer hover:bg-ember-tint/50 hover:[&_.title-span]:text-ember"
                      : failed
                      ? "hover:bg-ink/[0.03]"
                      : "",
                  ].join(" ")}
                >
                  {/* Left: dot + info */}
                  <div className="flex items-start gap-2.5 min-w-0 md:gap-3">
                    <StatusDot status={run.status} />
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-1.5 flex-wrap md:gap-2">
                        <span className={`title-span text-xs font-bold tracking-tight md:text-sm transition-colors duration-150 ${failed ? "text-ink-faint line-through" : "text-ink"}`}>
                          {run.job_title || "Tailored Résumé"}
                        </span>
                        {run.company && (
                          <span className="at-span text-xs text-ink-faint font-semibold truncate transition-colors duration-150">
                            at {run.company}
                          </span>
                        )}
                      </div>
                      <p className="date-p text-[11px] text-ink-faint mt-0.5 transition-colors duration-150">
                        {date}
                        <span className="dot-span mx-1 text-ink-faint transition-colors duration-150">·</span>
                        {run.template_id}
                        {failed && (
                          <><span className="dot-span mx-1 text-ink-faint transition-colors duration-150">·</span><span className="text-red-400 font-medium">Failed</span></>
                        )}
                      </p>
                      <div className="mt-1.5"><JobDescriptionPeek runId={run.id} /></div>
                    </div>
                  </div>

                  {/* Right: preview + edit + delete + report */}
                  <div className="flex items-center gap-1 shrink-0">
                    {failed && (
                      <span onClick={(e) => e.stopPropagation()}>
                        <ReportIssueButton
                          defaultCategory="generation"
                          defaultMessage={`[Generation failed]\nRun ID: ${run.id}\nTemplate: ${run.template_id}\nCreated: ${run.created_at}\nTitle: ${run.job_title || "Untailored"}\nCompany: ${run.company || "-"}\n\nDescribe your job description and expected output:\n`}
                          generationId={run.id}
                          title="Report failed generation"
                          description="Run ID is prefilled. Just describe the job description you used."
                          variant="outline"
                          size="sm"
                          className="hidden sm:inline-flex font-bold border-red-200 text-red-600 hover:bg-red-50 h-8"
                        >
                          <Bug size={13} /> Report
                        </ReportIssueButton>
                        <ReportIssueButton
                          defaultCategory="generation"
                          defaultMessage={`[Generation failed]\nRun ID: ${run.id}\nTemplate: ${run.template_id}\n`}
                          generationId={run.id}
                          title="Report failed generation"
                          variant="outline"
                          size="icon-sm"
                          className="sm:hidden border-red-200 text-red-600"
                        >
                          <Bug size={14} />
                        </ReportIssueButton>
                      </span>
                    )}
                    {completed && (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); setFullscreenRun(run) }}
                          className="flex cursor-pointer items-center gap-1 rounded-md border border-line-strong bg-paper px-2.5 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-ink/30"
                          aria-label="Preview"
                          title="Fullscreen Preview"
                        >
                          <Eye size={13} />
                          <span className="hidden sm:inline">Preview</span>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); window.location.href = `/dashboard/history/${run.id}/edit` }}
                          className="flex cursor-pointer items-center gap-1 rounded-md border border-line-strong bg-paper px-2.5 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-ink/30"
                          aria-label="Edit"
                          title="Edit Résumé"
                        >
                          <Pencil size={13} />
                          <span className="hidden sm:inline">Edit</span>
                        </button>
                      </>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteRun(run.id) }}
                      className="delete-btn shrink-0 cursor-pointer rounded-md p-2 text-ink-faint opacity-100 transition-colors hover:bg-red-500/10 hover:text-red-600 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
                      aria-label="Delete"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          {hasNextPage && (
            <div ref={sentinelRef} className="p-4 text-center border-t border-line bg-ink/[0.03]">
              <button
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
                className="cursor-pointer rounded-md border border-line-strong bg-paper px-4 py-2 text-xs font-semibold text-ink transition-colors hover:border-ink/30"
              >
                {isFetchingNextPage ? "Loading..." : `Load more (${remaining} remaining)`}
              </button>
            </div>
          )}
        </>
      )}
      {activeGenForFeedback && (
        <FeedbackModal
          generationId={activeGenForFeedback}
          onClose={() => setActiveGenForFeedback(null)}
        />
      )}

      {fullscreenRun && (
        <FullscreenResumeOverlay
          run={fullscreenRun}
          onClose={() => setFullscreenRun(null)}
        />
      )}
    </div>
  )
}
