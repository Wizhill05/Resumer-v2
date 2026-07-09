"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Save, Download, RotateCcw, X, Loader2 } from "lucide-react"
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
  const [editorMode, setEditorMode] = useState<"form" | "json">("form")

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

  // Zoom
  const [zoom] = useState<number>(0.75)

  // Live HTML preview (debounced)
  const { html, loading: previewLoading } = useDebouncedHtmlPreview({
    genId: payload.id,
    resume: parsedResume,
    profile: profile as Record<string, unknown>,
    fontSizePt: payload.manifest.max_font_size, // client BS will override via CSS var
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

  function handleFitChange(fontPt: number, pageCount: number, fits: boolean) {
    setFitFontPt(fontPt)
    setFitPageCount(pageCount)
    setFitWarning(!fits)
  }

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
    <div className="flex flex-col h-screen bg-white overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 bg-white shrink-0">
        <button
          onClick={handleClose}
          className="p-1 text-zinc-400 hover:text-zinc-700 transition-colors"
          aria-label="Close editor"
        >
          <X size={16} />
        </button>

        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-zinc-800 truncate">{title}</span>
          {dirty && <span className="ml-2 text-xs text-amber-500">unsaved</span>}
        </div>

        {/* Fit info */}
        <FontFitBar
          fontPt={fitFontPt}
          pageCount={fitPageCount}
          fits={!fitWarning}
          minFontSize={payload.manifest.min_font_size}
          maxFontSize={payload.manifest.max_font_size}
          targetPages={payload.manifest.target_pages}
        />

        <div className="flex items-center gap-1">
          <button
            onClick={handleReset}
            disabled={!dirty || saving}
            className="px-2.5 py-1.5 text-xs border border-zinc-200 text-zinc-600 hover:border-zinc-400 disabled:opacity-40 transition-colors"
            title="Reset to last saved"
          >
            <RotateCcw size={13} className="inline mr-1" />
            Reset
          </button>

          <button
            onClick={handleSave}
            disabled={!dirty || !!jsonError || saving}
            className="px-2.5 py-1.5 text-xs border border-zinc-200 text-zinc-600 hover:border-zinc-400 disabled:opacity-40 transition-colors flex items-center gap-1"
            title="Save (⌘S)"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Save
          </button>

          <button
            onClick={handleExportPdf}
            disabled={saving}
            className="px-2.5 py-1.5 text-xs bg-[#ff4e26] text-white hover:bg-[#e03d1a] disabled:opacity-40 transition-colors flex items-center gap-1"
          >
            <Download size={13} />
            Export PDF
          </button>
        </div>
      </div>

      {/* Error bar */}
      {saveError && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700 flex items-center justify-between">
          <span>{saveError}</span>
          <button onClick={() => setSaveError(null)} className="ml-2 text-red-400 hover:text-red-600">
            <X size={13} />
          </button>
        </div>
      )}

      {/* Overflow warning */}
      {fitWarning && <FitWarningBanner pageCount={fitPageCount} />}

      {/* Split pane */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left — Editor (45%) */}
        <div className="w-[45%] min-w-0 border-r border-gray-200 flex flex-col overflow-hidden bg-white">
          {/* Mode Toggler */}
          <div className="flex border-b border-zinc-200 bg-zinc-100 shrink-0">
            <button
              onClick={() => setEditorMode("form")}
              className={`flex-1 py-2 text-xs font-black uppercase tracking-wider text-center border-r border-zinc-200 outline-none transition-colors cursor-pointer ${
                editorMode === "form" ? "bg-white text-zinc-900 border-b-2 border-b-[#ff4e26]" : "text-zinc-500 hover:text-zinc-900"
              }`}
            >
              Form Editor
            </button>
            <button
              onClick={() => setEditorMode("json")}
              className={`flex-1 py-2 text-xs font-black uppercase tracking-wider text-center outline-none transition-colors cursor-pointer ${
                editorMode === "json" ? "bg-white text-zinc-900 border-b-2 border-b-[#ff4e26]" : "text-zinc-500 hover:text-zinc-900"
              }`}
            >
              Raw JSON
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

        {/* Right — preview (55%) */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <ResumePreviewPane
            html={html}
            loading={previewLoading}
            manifest={payload.manifest}
            zoom={zoom}
            onFitChange={handleFitChange}
          />
        </div>
      </div>
    </div>
  )
}
