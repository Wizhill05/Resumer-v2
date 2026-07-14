"use client"

import { useEffect, useState } from "react"
import { ZoomIn, ZoomOut } from "lucide-react"
import type { EditorManifest } from "@/lib/resume-schema"
import type { PdfPreview } from "./useDebouncedHtmlPreview"

const A4_WIDTH_PX = (210 / 25.4) * 96

type Props = {
  preview: PdfPreview | null
  loading: boolean
  manifest: EditorManifest
  onFitChange?: (fontPt: number, pageCount: number, fits: boolean) => void
}

export function ResumePreviewPane({ preview, loading, manifest, onFitChange }: Props) {
  const [zoom, setZoom] = useState(0.75)

  useEffect(() => {
    if (window.innerWidth < 768) setZoom(0.42)
  }, [])

  useEffect(() => {
    if (!preview) return
    onFitChange?.(preview.fontSize, preview.pageCount, !preview.fitWarning)
  }, [preview, onFitChange])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-zinc-100">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-500">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-medium text-zinc-700">PDF preview</span>
          {loading && <span className="animate-pulse text-[#ff4e26]">Updating...</span>}
          {preview && <span className="hidden sm:inline">{preview.pageCount} {preview.pageCount === 1 ? "page" : "pages"}</span>}
        </div>
        <div className="flex items-center gap-1.5 rounded border border-zinc-200 bg-zinc-50 px-1 py-0.5">
          <button
            onClick={() => setZoom((value) => Math.max(0.35, value - 0.1))}
            className="cursor-pointer rounded p-0.5 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-800"
            title="Zoom out"
            aria-label="Zoom out"
          >
            <ZoomOut size={12} />
          </button>
          <span className="w-9 text-center font-mono text-[10px] font-bold text-zinc-700">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom((value) => Math.min(1.5, value + 0.1))}
            className="cursor-pointer rounded p-0.5 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-800"
            title="Zoom in"
            aria-label="Zoom in"
          >
            <ZoomIn size={12} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-zinc-200 p-3 sm:p-5">
        {preview ? (
          <div className="mx-auto flex w-max flex-col items-center gap-6 sm:gap-8">
            {preview.pageImages.map((pageImage, index) => (
              <section key={`${index}-${pageImage.length}`} className="flex flex-col items-center gap-2">
                <div
                  className="overflow-hidden bg-white shadow-[0_2px_10px_rgb(24_24_27/0.20)] ring-1 ring-zinc-300"
                  style={{ width: A4_WIDTH_PX * zoom }}
                >
                  <img
                    src={pageImage}
                    alt={`Resume page ${index + 1}`}
                    className="block h-auto w-full"
                    draggable={false}
                  />
                </div>
                <span className="text-[10px] font-medium text-zinc-600">Page {index + 1}</span>
              </section>
            ))}
          </div>
        ) : (
          <div
            className="mx-auto flex items-center justify-center bg-white text-sm text-zinc-400 shadow-[0_2px_10px_rgb(24_24_27/0.16)]"
            style={{ width: A4_WIDTH_PX * zoom, aspectRatio: "210 / 297" }}
          >
            {loading ? "Rendering PDF preview..." : "Edit your resume to load the preview"}
          </div>
        )}
      </div>

      {preview?.fitWarning && (
        <div className="shrink-0 border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          The document needs more than {manifest.target_pages} page{manifest.target_pages === 1 ? "" : "s"} at the smallest allowed text size.
        </div>
      )}
    </div>
  )
}
