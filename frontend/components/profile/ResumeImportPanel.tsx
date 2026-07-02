"use client"

import { useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Loader2, Upload, X } from "lucide-react"

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

export function ResumeImportPanel() {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [draft, setDraft] = useState<ResumeImportDraft | null>(null)
  const [error, setError] = useState<string | null>(null)

  const importMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const formData = new FormData()
      files.forEach((file) => formData.append("files", file))
      const res = await fetch("/api/backend/profile/import/resumes", { method: "POST", body: formData })
      const body = await res.json()
      if (!res.ok) {
        const detail = body.detail
        const msg = Array.isArray(detail)
          ? detail.map((e: { msg?: string }) => e.msg ?? JSON.stringify(e)).join(", ")
          : typeof detail === "string"
          ? detail
          : "Failed to import resume"
        throw new Error(msg)
      }
      return body as ResumeImportDraft
    },
    onSuccess: (data) => {
      setError(null)
      setDraft(data)
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to import resume"),
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
              if (files.length) importMutation.mutate(files)
              event.target.value = ""
            }}
          />
          <Button type="button" onClick={() => inputRef.current?.click()} disabled={importMutation.isPending}>
            {importMutation.isPending ? <><Loader2 className="animate-spin" size={16} /> Extracting...</> : <><Upload size={16} /> Import PDFs</>}
          </Button>
        </div>
      </div>

      {error && <p className="border border-red-200 bg-red-50 p-2 text-xs font-bold text-red-700">{error}</p>}

      {draft && (
        <div className="space-y-3 border border-zinc-200 bg-zinc-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-extrabold uppercase">Review import draft</p>
              <p className="text-xs font-semibold text-zinc-600">{counts.join(" • ")}</p>
            </div>
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => setDraft(null)} className="border-transparent">
              <X size={14} />
            </Button>
          </div>

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

          {(draft.warnings?.length ?? 0) > 0 && (
            <div className="space-y-1 border border-zinc-200 bg-white p-2">
              <p className="text-xs font-extrabold uppercase text-zinc-700">Warnings</p>
              {draft.warnings?.slice(0, 4).map((warning, index) => (
                <p key={index} className="text-xs font-semibold text-zinc-600">{warning.scope}: {warning.message}</p>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending}>
              {applyMutation.isPending ? <><Loader2 className="animate-spin" size={16} /> Saving...</> : "Apply Import"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setDraft(null)} disabled={applyMutation.isPending}>Skip</Button>
          </div>
        </div>
      )}
    </div>
  )
}
