"use client"

import { useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { AlertCircle, CheckCircle2, Loader2, Upload, X } from "lucide-react"

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

type Stage = "idle" | "parsing" | "extracting" | "done"

export function ResumeImportPanel() {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [draft, setDraft] = useState<ResumeImportDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>("idle")
  const [fileCount, setFileCount] = useState(0)

  const importMutation = useMutation({
    mutationFn: async (files: File[]) => {
      setFileCount(files.length)

      // Stage 1: parse PDFs to text
      setStage("parsing")
      const formData = new FormData()
      files.forEach((file) => formData.append("files", file))
      const parseRes = await fetch("/api/backend/profile/import/parse", { method: "POST", body: formData })
      const parseBody = await parseRes.json()
      if (!parseRes.ok) {
        const detail = parseBody.detail
        const msg = Array.isArray(detail)
          ? detail.map((e: { msg?: string }) => e.msg ?? JSON.stringify(e)).join(", ")
          : typeof detail === "string"
          ? detail
          : "Failed to parse resume"
        throw new Error(msg)
      }

      // Stage 2: LLM extraction
      setStage("extracting")
      const extractRes = await fetch("/api/backend/profile/import/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parseBody),
      })
      const extractBody = await extractRes.json()
      if (!extractRes.ok) {
        const detail = extractBody.detail
        const msg = Array.isArray(detail)
          ? detail.map((e: { msg?: string }) => e.msg ?? JSON.stringify(e)).join(", ")
          : typeof detail === "string"
          ? detail
          : "Failed to extract resume data"
        throw new Error(msg)
      }
      return extractBody as ResumeImportDraft
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
      : "Extracting..."

  const stageHint =
    stage === "parsing"
      ? "Parsing document text"
      : stage === "extracting"
      ? "Running AI extraction — takes ~10s per file"
      : ""

  const isPending = importMutation.isPending

  return (
    <div className="panel space-y-3 p-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-widest text-[#ff4e26]">Fast import</p>
          <h2 className="text-lg font-extrabold uppercase tracking-tight">Upload old resumes</h2>
          <p className="text-sm font-medium text-zinc-600">PDF only. Max 5 files, 5MB each. We stage results before saving.</p>
        </div>
        <div className="flex gap-2">
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
                importMutation.mutate(files)
              }
              event.target.value = ""
            }}
          />
          <Button type="button" onClick={() => inputRef.current?.click()} disabled={isPending}>
            {isPending ? <><Loader2 className="animate-spin" size={16} /> {stageLabel}</> : <><Upload size={16} /> Import PDFs</>}
          </Button>
        </div>
      </div>

      {/* Stage progress indicator */}
      {isPending && (
        <div className="space-y-1.5 border border-zinc-200 bg-zinc-50 p-3">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <span className={`h-2 w-2 rounded-full ${stage === "parsing" || stage === "extracting" ? "bg-[#ff4e26]" : "bg-zinc-300"}`} />
              <span className={`h-2 w-2 rounded-full ${stage === "extracting" ? "bg-[#ff4e26]" : "bg-zinc-300"}`} />
            </div>
            <p className="text-xs font-semibold text-zinc-700">{stageLabel}</p>
          </div>
          {stageHint && <p className="text-xs text-zinc-500">{stageHint}</p>}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 border border-red-200 bg-red-50 p-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-600" />
          <p className="text-xs font-bold text-red-700">{error}</p>
        </div>
      )}

      {draft && (
        <div className="space-y-3 border border-zinc-200 bg-zinc-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-extrabold uppercase">Review import draft</p>
              <p className="text-xs font-semibold text-zinc-600">{counts.join(" • ")}</p>
            </div>
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => { setDraft(null); setStage("idle") }} className="border-transparent">
              <X size={14} />
            </Button>
          </div>

          {(draft.warnings?.filter(w => w.scope === "general").length ?? 0) > 0 && (
            <div className="flex items-start gap-2 border border-yellow-200 bg-yellow-50 p-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0 text-yellow-700" />
              <div className="space-y-0.5">
                {draft.warnings?.filter(w => w.scope === "general").map((w, i) => (
                  <p key={i} className="text-xs font-semibold text-yellow-900">{w.message}</p>
                ))}
              </div>
            </div>
          )}

          {(draft.duplicate_candidates?.length ?? 0) > 0 && (
            <div className="space-y-1 border border-yellow-200 bg-yellow-50 p-2">
              <p className="text-xs font-extrabold uppercase text-yellow-800">Duplicates detected</p>
              {draft.duplicate_candidates?.slice(0, 4).map((dup, index) => (
                <p key={index} className="text-xs font-semibold text-yellow-900">
                  {dup.imported_type}: {dup.reason} ({Math.round(dup.confidence * 100)}%, {dup.suggested_action})
                </p>
              ))}
            </div>
          )}

          {(draft.warnings?.filter(w => w.scope !== "general").length ?? 0) > 0 && (
            <div className="space-y-1 border border-zinc-200 bg-white p-2">
              <p className="text-xs font-extrabold uppercase text-zinc-700">Warnings</p>
              {draft.warnings?.filter(w => w.scope !== "general").slice(0, 4).map((warning, index) => (
                <p key={index} className="text-xs font-semibold text-zinc-600">{warning.scope}: {warning.message}</p>
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
