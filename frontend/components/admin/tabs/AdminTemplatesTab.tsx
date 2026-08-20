"use client"

import React, { useState } from "react"
import { Play, Eye, FileCode, Sparkles } from "lucide-react"

const AVAILABLE_TEMPLATES = [
  { id: "modern", name: "Modern Clean (Default)", description: "Balanced single-column layout with bold section headers." },
  { id: "minimal", name: "Minimalist Grid", description: "Ultra-compact typography focused on space efficiency." },
  { id: "technical", name: "Technical / Engineering", description: "Highlights tech stacks, repos, and quantitative metrics." },
  { id: "executive", name: "Executive Leadership", description: "Formal serif headers and comprehensive career timeline." },
]

export function AdminTemplatesTab() {
  const [selectedTemplate, setSelectedTemplate] = useState("modern")
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleRenderPreview = async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/backend/admin/templates/${selectedTemplate}/preview`, {
        method: "POST",
      })
      if (res.ok) {
        const html = await res.text()
        setPreviewHtml(html)
      } else {
        setPreviewHtml(`<div style="padding: 20px; color: red; font-family: monospace;">Failed to render template preview (Status: ${res.status})</div>`)
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      setPreviewHtml(`<div style="padding: 20px; color: red; font-family: monospace;">Render error: ${errorMsg}</div>`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Left: Template Selector */}
      <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-[2px_2px_0px_#000000] space-y-4">
        <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 pb-3">
          <Play size={16} className="text-[#ff4e26]" />
          <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-white">
            Template Registry
          </h3>
        </div>

        <div className="space-y-2 font-mono text-xs">
          {AVAILABLE_TEMPLATES.map((tmpl) => {
            const isSelected = tmpl.id === selectedTemplate
            return (
              <button
                key={tmpl.id}
                type="button"
                onClick={() => setSelectedTemplate(tmpl.id)}
                className={`w-full text-left p-3 border transition-all ${
                  isSelected
                    ? "border-black dark:border-white bg-[#ff4e26] text-white shadow-[2px_2px_0px_#000000]"
                    : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 hover:border-zinc-400"
                }`}
              >
                <div className="font-bold uppercase text-xs">{tmpl.name}</div>
                <div className={`text-[11px] mt-1 ${isSelected ? "text-white/90" : "text-zinc-500"}`}>
                  {tmpl.description}
                </div>
              </button>
            )
          })}
        </div>

        <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <button
            type="button"
            onClick={handleRenderPreview}
            disabled={isLoading}
            className="flex w-full items-center justify-center gap-1.5 border border-black dark:border-white bg-[#ff4e26] px-4 py-2.5 font-mono text-xs font-bold uppercase text-white shadow-[2px_2px_0px_#000000] hover:bg-[#e03d16] transition-all disabled:opacity-50"
          >
            <Eye size={14} className={isLoading ? "animate-spin" : ""} />
            <span>{isLoading ? "Rendering Template..." : "Render Sandbox Preview"}</span>
          </button>
        </div>
      </div>

      {/* Right: Live Preview Box */}
      <div className="lg:col-span-2 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-[2px_2px_0px_#000000] space-y-3">
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <FileCode size={16} className="text-[#ff4e26]" />
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-white">
              HTML / WeasyPrint PDF Preview Canvas
            </h3>
          </div>
          <span className="font-mono text-[10px] uppercase font-bold text-zinc-400">
            Target: {selectedTemplate}
          </span>
        </div>

        <div className="h-[600px] w-full border border-zinc-200 dark:border-zinc-800 bg-white overflow-hidden shadow-inner">
          {previewHtml ? (
            <iframe
              srcDoc={previewHtml}
              title="Template Preview"
              className="h-full w-full border-0"
              sandbox="allow-same-origin"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center font-mono text-xs text-zinc-400 bg-zinc-50 dark:bg-zinc-950">
              <Sparkles size={28} className="text-zinc-500 mb-2" />
              <p className="font-bold text-zinc-700 dark:text-zinc-300">Sandbox Preview Ready</p>
              <p className="mt-1 max-w-sm text-zinc-500">
                Click &ldquo;Render Sandbox Preview&rdquo; to execute Jinja2 compilation against sample candidate profile records.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
