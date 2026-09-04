"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Save, Download, RotateCcw, X, Loader2, Eye, Edit3 } from "lucide-react"
import { ReportIssueButton } from "@/components/support/ReportIssueDialog"
import { ResumeJsonEditor } from "@/components/editor/ResumeJsonEditor"
import { ResumeFormEditor } from "@/components/editor/ResumeFormEditor"
import { ResumePreviewPane } from "@/components/editor/ResumePreviewPane"
import { FitWarningBanner } from "@/components/editor/FitWarningBanner"
import { FontFitBar } from "@/components/editor/FontFitBar"
import { useDebouncedHtmlPreview } from "@/components/editor/useDebouncedHtmlPreview"
import type { EditorPayload, EditorSaveResponse, EditorProfile, TailoredResume } from "@/lib/resume-schema"

type Props = {
  payload: EditorPayload
}

export function EditorClient({ payload }: Props) {
  const router = useRouter()

  // Editor view mode
  const [editorMode, setEditorMode] = useState<"form" | "json" | "preview">("form")
  const [lastEditMode, setLastEditMode] = useState<"form" | "json">("form")

  // Editor state
  const [rawJson, setRawJson] = useState<string>(
    JSON.stringify(payload.tailored_resume, null, 2)
  )
  const [parsedResume, setParsedResume] = useState<Record<string, unknown> | null>(
    payload.tailored_resume as Record<string, unknown>
  )
  const [profile, setProfile] = useState<EditorProfile>(payload.profile)
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  // Fit state from preview pane
  const [fitFontPt, setFitFontPt] = useState<number>(payload.font_size ?? payload.manifest.max_font_size)
  const [fitPageCount, setFitPageCount] = useState<number>(payload.page_count ?? 1)
  const [fitWarning, setFitWarning] = useState<boolean>(payload.fit_warning)
  const [revision, setRevision] = useState<number>(payload.editor_revision)

  // Save state
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Authoritative PDF preview (debounced)
  const { preview, loading: previewLoading } = useDebouncedHtmlPreview({
    genId: payload.id,
    resume: parsedResume,
    profile: profile as Record<string, unknown>,
    enabled: parsedResume !== null,
  })

  function handleEditorChange(
    raw: string,
    parsed: Record<string, unknown> | null,
    err: string | null
  ) {
    setRawJson(raw)
    setParsedResume(parsed)
    setJsonError(err)
    if (!dirty) setDirty(true)
  }

  function handleFormUpdate(updatedResume: TailoredResume, updatedProfile: EditorProfile) {
    setParsedResume(updatedResume as Record<string, unknown>)
    setRawJson(JSON.stringify(updatedResume, null, 2))
    setProfile(updatedProfile)
    setJsonError(null)
    if (!dirty) setDirty(true)
  }

  const handleFitChange = useCallback((fontPt: number, pageCount: number, fits: boolean) => {
    setFitFontPt(fontPt)
    setFitPageCount(pageCount)
    setFitWarning(!fits)
  }, [])

  async function handleSave() {
    if (!parsedResume || jsonError) return
    setSaving(true)
    setSaveError(null)

    try {
      const res = await fetch(`/api/backend/generate/${payload.id}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resume: parsedResume,
          profile,
          expected_revision: revision,
        }),
      })

      if (res.status === 409) {
        setSaveError("Revision conflict — another save happened. Reload to continue.")
        return
      }
      if (!res.ok) {
        const text = await res.text()
        setSaveError(`Save failed: ${text}`)
        return
      }

      const data: EditorSaveResponse = await res.json()
      setRevision(data.editor_revision)
      setFitFontPt(data.font_size)
      setFitPageCount(data.page_count)
      setFitWarning(data.fit_warning)
      setDirty(false)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  async function handleExportPdf() {
    if (dirty) await handleSave()
    window.location.href = `/api/backend/generate/${payload.id}/download`
  }

  function handleReset() {
    if (!confirm("Reset to last saved version? Unsaved changes will be lost.")) return
    setRawJson(JSON.stringify(payload.tailored_resume, null, 2))
    setParsedResume(payload.tailored_resume as Record<string, unknown>)
    setProfile(payload.profile)
    setJsonError(null)
    setDirty(false)
  }

  function handleClose() {
    if (dirty && !confirm("You have unsaved changes. Close anyway?")) return
    router.push("/dashboard/history")
  }

  // Keyboard shortcut: Cmd/Ctrl + S → save
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [parsedResume, profile, jsonError, revision]) // eslint-disable-line react-hooks/exhaustive-deps

  const title = [payload.job_title, payload.company].filter(Boolean).join(" — ") || "Resume Editor"

  return (
    <div className="flex flex-col h-screen h-[100dvh] max-h-[100dvh] bg-white dark:bg-zinc-900 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 shrink-0">
        <button
          onClick={handleClose}
          className="p-1 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
          aria-label="Close editor"
        >
          <X size={16} />
        </button>

        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-zinc-950 dark:text-zinc-100 truncate">{title}</span>
          {dirty && <span className="ml-2 text-xs text-amber-600 font-bold">unsaved</span>}
        </div>

        {/* Fit info */}
        <div className={editorMode === "preview" ? "block" : "hidden md:block"}>
          <FontFitBar
            fontPt={fitFontPt}
            pageCount={fitPageCount}
            fits={!fitWarning}
            minFontSize={payload.manifest.min_font_size}
            maxFontSize={payload.manifest.max_font_size}
            targetPages={payload.manifest.target_pages}
          />
        </div>

        <div className="hidden md:flex items-center gap-1">
          <button
            onClick={handleReset}
            disabled={!dirty || saving}
            className="px-2.5 py-1.5 text-xs border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:border-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 transition-colors cursor-pointer font-medium"
            title="Reset to last saved"
          >
            <RotateCcw size={13} className="inline mr-1" />
            Reset
          </button>

          <button
            onClick={handleSave}
            disabled={!dirty || !!jsonError || saving}
            className="px-2.5 py-1.5 text-xs border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:border-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 transition-colors flex items-center gap-1 cursor-pointer font-medium"
            title="Save (⌘S)"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Save
          </button>

          <button
            onClick={handleExportPdf}
            disabled={saving}
            className="px-2.5 py-1.5 text-xs bg-[#ff4e26] text-white hover:bg-[#e03d16] disabled:opacity-40 transition-colors flex items-center gap-1 cursor-pointer font-semibold shadow-sm"
          >
            <Download size={13} />
            Export PDF
          </button>
        </div>
      </div>

      {/* Error bar */}
      {saveError && (
        <div className="px-4 py-2.5 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-800 flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
          <span className="text-sm font-semibold text-red-700 dark:text-red-400 break-words">{saveError}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <ReportIssueButton
              defaultCategory="template"
              defaultMessage={`[Editor save failed]\nRun ID: ${payload.id}\nError: ${saveError}\nRevision: ${revision}\nJSON error: ${jsonError || "none"}\n\nDescribe what you edited before saving:\n`}
              generationId={payload.id}
              title="Report editor issue"
              description="Run ID and error are prefilled. Describe your edit."
              variant="outline"
              size="xs"
              className="border-red-300 text-red-700 hover:bg-red-100 bg-white font-black uppercase tracking-wider text-[11px] h-7"
            >
              Report
            </ReportIssueButton>
            <button onClick={() => setSaveError(null)} className="ml-1 text-red-400 hover:text-red-600 p-1">
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Overflow warning */}
      {fitWarning && <FitWarningBanner pageCount={fitPageCount} />}

      {/* Split pane / Content area */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* Left — Editor (Full on mobile, 45% on desktop; hidden on mobile if in preview mode) */}
        <div
          className={`w-full md:w-[45%] min-w-0 min-h-0 md:border-r border-zinc-300 dark:border-zinc-700 flex flex-col overflow-hidden bg-white dark:bg-zinc-900 ${
            editorMode === "preview" ? "hidden md:flex" : "flex"
          }`}
        >
          {/* Mode Toggler */}
          <div className="flex border-b border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900 shrink-0">
            <button
              onClick={() => {
                setEditorMode("form")
                setLastEditMode("form")
              }}
              className={`flex-1 py-2 text-xs font-black uppercase tracking-wider text-center border-r border-zinc-300 dark:border-zinc-700 outline-none transition-colors cursor-pointer ${
                editorMode === "form"
                  ? "bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 border-b-2 border-b-[#ff4e26]"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200"
              }`}
            >
              Form Editor
            </button>
            <button
              onClick={() => {
                setEditorMode("json")
                setLastEditMode("json")
              }}
              className={`flex-1 py-2 text-xs font-black uppercase tracking-wider text-center border-r md:border-r-0 border-zinc-300 dark:border-zinc-700 outline-none transition-colors cursor-pointer ${
                editorMode === "json"
                  ? "bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 border-b-2 border-b-[#ff4e26]"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200"
              }`}
            >
              Raw JSON
            </button>
            {/* Mobile-only Preview segment tab */}
            <button
              onClick={() => setEditorMode("preview")}
              className={`md:hidden flex-1 py-2 text-xs font-black uppercase tracking-wider text-center outline-none transition-colors cursor-pointer ${
                editorMode === "preview"
                  ? "bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 border-b-2 border-b-[#ff4e26]"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200"
              }`}
            >
              Preview
            </button>
          </div>

          {editorMode === "form" ? (
            <ResumeFormEditor
              resume={(parsedResume || {}) as TailoredResume}
              profile={profile}
              onUpdate={handleFormUpdate}
            />
          ) : (
            <ResumeJsonEditor value={rawJson} onChange={handleEditorChange} />
          )}
        </div>

        {/* Right / Preview Pane (Visible on desktop always; on mobile only when editorMode === "preview") */}
        <div
          className={`flex-1 min-w-0 min-h-0 flex-col overflow-hidden ${
            editorMode === "preview" ? "flex" : "hidden md:flex"
          }`}
        >
          {/* Mobile subheader when viewing preview to easily switch back */}
          <div className="md:hidden flex border-b border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900 shrink-0">
            <button
              onClick={() => {
                setEditorMode("form")
                setLastEditMode("form")
              }}
              className="flex-1 py-2 text-xs font-black uppercase tracking-wider text-center border-r border-zinc-300 dark:border-zinc-700 outline-none transition-colors cursor-pointer text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200"
            >
              Form Editor
            </button>
            <button
              onClick={() => {
                setEditorMode("json")
                setLastEditMode("json")
              }}
              className="flex-1 py-2 text-xs font-black uppercase tracking-wider text-center border-r border-zinc-300 dark:border-zinc-700 outline-none transition-colors cursor-pointer text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200"
            >
              Raw JSON
            </button>
            <button
              onClick={() => setEditorMode("preview")}
              className="flex-1 py-2 text-xs font-black uppercase tracking-wider text-center outline-none transition-colors cursor-pointer bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 border-b-2 border-b-[#ff4e26]"
            >
              Preview
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            <ResumePreviewPane
              preview={preview}
              loading={previewLoading}
              manifest={payload.manifest}
              onFitChange={handleFitChange}
            />
          </div>
        </div>
      </div>

      {/* Bottom Sticky Action Navigation Bar (Mobile Only) */}
      <div className="shrink-0 h-16 border-t border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex items-center justify-around px-4 md:hidden z-40">
        {editorMode === "preview" ? (
          <button
            onClick={() => setEditorMode(lastEditMode)}
            className="flex-1 max-w-[100px] flex flex-col items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white cursor-pointer"
          >
            <Edit3 size={20} />
            <span className="text-[10px] font-black uppercase tracking-wide mt-0.5">Edit</span>
          </button>
        ) : (
          <button
            onClick={() => setEditorMode("preview")}
            className="flex-1 max-w-[100px] flex flex-col items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white cursor-pointer"
          >
            <Eye size={20} />
            <span className="text-[10px] font-black uppercase tracking-wide mt-0.5">Preview</span>
          </button>
        )}

        <button
          onClick={handleSave}
          disabled={!dirty || !!jsonError || saving}
          className="flex-1 max-w-[100px] flex flex-col items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white disabled:opacity-40 cursor-pointer"
        >
          {saving ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />}
          <span className="text-[10px] font-black uppercase tracking-wide mt-0.5">{saving ? "Saving..." : "Save"}</span>
        </button>

        <button
          onClick={handleExportPdf}
          disabled={saving}
          className="flex-1 max-w-[100px] flex flex-col items-center justify-center text-[#ff4e26] hover:text-[#e03d16] disabled:opacity-40 cursor-pointer"
        >
          <Download size={20} />
          <span className="text-[10px] font-black uppercase tracking-wide mt-0.5">Export PDF</span>
        </button>
      </div>
    </div>
  )
}
