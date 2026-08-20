"use client"

import { useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { AlertCircle, CheckCircle2, Loader2, Upload, X, ChevronDown, ChevronUp, FileUp } from "lucide-react"
type ImportWarning = { scope: string; message: string }
type DuplicateCandidate = { imported_type: string; confidence: number; reason: string; suggested_action: string }
type ResumeImportDraft = {
  profile?: Record<string, unknown>
  experiences?: unknown[]
  projects?: unknown[]
  education?: unknown[]
  extracurriculars?: unknown[]
  duplicate_candidates?: DuplicateCandidate[]
  warnings?: ImportWarning[]
}

type Stage = "idle" | "parsing" | "extracting" | "deduplicating" | "done"

export function ResumeImportPanel() {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [draft, setDraft] = useState<ResumeImportDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>("idle")
  const [fileCount, setFileCount] = useState(0)
  const [mobileExpanded, setMobileExpanded] = useState(false)

  const importMutation = useMutation({
    mutationFn: async (files: File[]) => {
      setFileCount(files.length)

      setStage("parsing")
      const formData = new FormData()
      files.forEach((file) => formData.append("files", file))
      const startRes = await fetch("/api/backend/profile/import/start", { method: "POST", body: formData })
      const startBody = await startRes.json()
      if (!startRes.ok) {
        const detail = startBody.detail
        const msg = Array.isArray(detail)
          ? detail.map((e: { msg?: string }) => e.msg ?? JSON.stringify(e)).join(", ")
          : typeof detail === "string"
          ? detail
          : "Failed to start import"
        throw new Error(msg)
      }

      const jobId = startBody.job_id
      let jobStatus = "parsing"
      let jobResult = null
      let jobError = null

      while (jobStatus === "parsing" || jobStatus === "extracting" || jobStatus === "deduplicating") {
        await new Promise((resolve) => setTimeout(resolve, 1500))
        const statusRes = await fetch(`/api/backend/profile/import/status/${jobId}`)
        const statusBody = await statusRes.json()
        if (!statusRes.ok) {
          throw new Error("Failed to check import status")
        }
        jobStatus = statusBody.status
        jobResult = statusBody.result
        jobError = statusBody.error
        setStage(jobStatus as Stage)
      }

      if (jobStatus === "failed") {
        throw new Error(jobError || "Import failed")
      }

      return jobResult as ResumeImportDraft
    },
    onSuccess: (data) => {
      setError(null)
      setDraft(data)
      setStage("done")
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to import resume")
      setStage("idle")
    },
  })

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!draft) return
      const res = await fetch("/api/backend/profile/import/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.detail || "Failed to apply import")
      return body
    },
    onSuccess: () => {
      setDraft(null)
      setStage("idle")
      queryClient.invalidateQueries({ queryKey: ["profile"] })
      queryClient.invalidateQueries({ queryKey: ["projects"] })
      queryClient.invalidateQueries({ queryKey: ["experiences"] })
      queryClient.invalidateQueries({ queryKey: ["education"] })
      queryClient.invalidateQueries({ queryKey: ["extracurriculars"] })
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to apply import"),
  })

  const counts = draft
    ? [
        `${draft.experiences?.length ?? 0} experiences`,
        `${draft.projects?.length ?? 0} projects`,
        `${draft.education?.length ?? 0} education`,
        `${draft.extracurriculars?.length ?? 0} activities`,
      ]
    : []

  const stageLabel =
    stage === "parsing"
      ? `Reading PDF${fileCount > 1 ? "s" : ""}…`
      : stage === "extracting"
      ? "Extracting data with AI…"
      : stage === "deduplicating"
      ? "Removing duplicates…"
      : "Extracting..."

  const stageHint =
    stage === "parsing"
      ? "Parsing document text"
      : stage === "extracting"
      ? "Running AI extraction — takes ~10s per file"
      : stage === "deduplicating"
      ? "Comparing with existing entries"
      : ""

  const isPending = importMutation.isPending
  const showExpanded = mobileExpanded || isPending || draft !== null || error !== null

  return (
    <div className="border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/60 md:p-4">
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          if (files.length) {
            setError(null)
            setDraft(null)
            setStage("idle")
            setMobileExpanded(true)
            importMutation.mutate(files)
          }
          event.target.value = ""
        }}
      />

      {/* Mobile Collapsed Trigger Bar */}
      <div className="flex items-center justify-between gap-2 md:hidden">
        <button
          type="button"
          onClick={() => setMobileExpanded(!mobileExpanded)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left font-black uppercase tracking-tight text-zinc-800 dark:text-zinc-200"
        >
          <FileUp size={16} className="shrink-0 text-[#ff4e26]" />
          <span className="truncate text-xs">Import from PDF Resumes</span>
          {showExpanded ? <ChevronUp size={14} className="shrink-0 text-zinc-400" /> : <ChevronDown size={14} className="shrink-0 text-zinc-400" />}
        </button>
        <Button
          type="button"
          size="xs"
          onClick={() => inputRef.current?.click()}
          disabled={isPending}
          className="shrink-0"
        >
          {isPending ? <Loader2 className="animate-spin" size={12} /> : <><Upload size={12} /> Upload</>}
        </Button>
      </div>

      {/* Desktop Header & Mobile Expanded Body */}
      <div className={`${showExpanded ? "mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800 md:mt-0 md:pt-0 md:border-0" : "hidden"} md:block`}>
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-widest text-[#ff4e26]">Fast import</p>
            <h2 className="text-base font-extrabold uppercase tracking-tight text-zinc-900 dark:text-zinc-100 md:text-lg">Upload old resumes</h2>
            <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 md:text-sm">PDF only. Max 5 files, 5MB each. We stage results before saving.</p>
          </div>
          <div className="hidden md:flex md:gap-2">
            <Button type="button" onClick={() => inputRef.current?.click()} disabled={isPending}>
              {isPending ? <><Loader2 className="animate-spin" size={16} /> {stageLabel}</> : <><Upload size={16} /> Import PDFs</>}
            </Button>
          </div>
        </div>
      </div>
      {/* Stage progress indicator */}
      {isPending && (
        <div className="space-y-1.5 border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 p-3">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <span className={`h-2 w-2 rounded-full ${stage === "parsing" || stage === "extracting" || stage === "deduplicating" ? "bg-[#ff4e26]" : "bg-zinc-300 dark:bg-zinc-700"}`} />
              <span className={`h-2 w-2 rounded-full ${stage === "extracting" || stage === "deduplicating" ? "bg-[#ff4e26]" : "bg-zinc-300 dark:bg-zinc-700"}`} />
              <span className={`h-2 w-2 rounded-full ${stage === "deduplicating" ? "bg-[#ff4e26]" : "bg-zinc-300 dark:bg-zinc-700"}`} />
            </div>
            <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{stageLabel}</p>
          </div>
          {stageHint && <p className="text-xs text-zinc-500 dark:text-zinc-400">{stageHint}</p>}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
          <p className="text-xs font-bold text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {draft && (
        <div className="space-y-3 border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-extrabold uppercase text-zinc-900 dark:text-zinc-100">Review import draft</p>
              <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">{counts.join(" • ")}</p>
            </div>
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => { setDraft(null); setStage("idle") }} className="border-transparent">
              <X size={14} />
            </Button>
          </div>

          {(draft.warnings?.filter(w => w.scope === "general").length ?? 0) > 0 && (
            <div className="flex items-start gap-2 border border-yellow-200 dark:border-yellow-900/60 bg-yellow-50 dark:bg-yellow-950/40 p-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0 text-yellow-700 dark:text-yellow-400" />
              <div className="space-y-0.5">
                {draft.warnings?.filter(w => w.scope === "general").map((w, i) => (
                  <p key={i} className="text-xs font-semibold text-yellow-900 dark:text-yellow-200">{w.message}</p>
                ))}
              </div>
            </div>
          )}

          {(draft.duplicate_candidates?.length ?? 0) > 0 && (
            <div className="space-y-1 border border-yellow-200 dark:border-yellow-900/60 bg-yellow-50 dark:bg-yellow-950/40 p-2">
              <p className="text-xs font-extrabold uppercase text-yellow-800 dark:text-yellow-300">Duplicates detected</p>
              {draft.duplicate_candidates?.slice(0, 4).map((dup, index) => (
                <p key={index} className="text-xs font-semibold text-yellow-900 dark:text-yellow-200">
                  {dup.imported_type}: {dup.reason} ({Math.round(dup.confidence * 100)}%, {dup.suggested_action})
                </p>
              ))}
            </div>
          )}

          {(draft.warnings?.filter(w => w.scope !== "general").length ?? 0) > 0 && (
            <div className="space-y-1 border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2">
              <p className="text-xs font-extrabold uppercase text-zinc-700 dark:text-zinc-300">Warnings</p>
              {draft.warnings?.filter(w => w.scope !== "general").slice(0, 4).map((warning, index) => (
                <p key={index} className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">{warning.scope}: {warning.message}</p>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending}>
              {applyMutation.isPending ? <><Loader2 className="animate-spin" size={16} /> Saving...</> : "Apply Import"}
            </Button>
            <Button type="button" variant="outline" onClick={() => { setDraft(null); setStage("idle") }} disabled={applyMutation.isPending}>Skip</Button>
          </div>
        </div>
      )}
    </div>
  )
}
