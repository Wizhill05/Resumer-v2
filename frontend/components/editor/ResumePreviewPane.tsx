"use client"

import { useEffect, useRef } from "react"
import { useFontFit } from "./useFontFit"
import type { EditorManifest } from "@/lib/resume-schema"

// A4 dimensions in mm
const A4_WIDTH_MM = 210
const A4_HEIGHT_MM = 297

type Props = {
  html: string | null
  loading: boolean
  manifest: EditorManifest
  zoom?: number
  onFitChange?: (fontPt: number, pageCount: number, fits: boolean) => void
}

export function ResumePreviewPane({ html, loading, manifest, zoom = 1, onFitChange }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const { fitState, runSearch } = useFontFit({
    minFontSize: manifest.min_font_size,
    maxFontSize: manifest.max_font_size,
    targetPages: manifest.target_pages,
    pageMarginMm: manifest.page_margin_mm,
    iframeRef,
  })

  // Run client font search after iframe content updates
  useEffect(() => {
    if (!html) return
    const iframe = iframeRef.current
    if (!iframe) return

    const onLoad = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          runSearch()
        })
      })
    }

    iframe.addEventListener("load", onLoad)
    return () => iframe.removeEventListener("load", onLoad)
  }, [html, runSearch])

  // Notify parent of fit changes
  useEffect(() => {
    if (!fitState.searching) {
      onFitChange?.(fitState.fontPt, fitState.pageCount, fitState.fits)
    }
  }, [fitState, onFitChange])

  const widthPx = (A4_WIDTH_MM / 25.4) * 96
  const heightPx = (A4_HEIGHT_MM / 25.4) * 96
  const totalPages = Math.max(1, fitState.pageCount)

  return (
    <div className="flex flex-col h-full overflow-hidden bg-zinc-100">
      {/* Preview header */}
      <div className="px-3 py-1.5 border-b border-zinc-200 bg-white flex items-center gap-2 text-xs text-zinc-500">
        <span>Preview (approximate)</span>
        {loading && <span className="text-[#ff4e26]">updating...</span>}
      </div>

      {/* Scrollable preview area */}
      <div
        className="flex-1 overflow-auto flex flex-col items-center p-4"
        style={{ background: "#e5e5e5" }}
      >
        {html ? (
          <div
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "top center",
              width: widthPx,
              position: "relative",
            }}
          >
            {/* Iframe showing resume content */}
            <iframe
              ref={iframeRef}
              srcDoc={html}
              title="Resume preview"
              sandbox="allow-same-origin"
              className="w-full border-0 bg-white shadow-md"
              style={{
                width: widthPx,
                height: heightPx * totalPages,
                display: "block",
              }}
            />

            {/* Page boundary overlays — always shown, even for 1 page */}
            {Array.from({ length: totalPages }, (_, i) => {
              const top = heightPx * i
              const isOverflow = i >= manifest.target_pages
              return (
                <div key={i} style={{ position: "absolute", top, left: 0, width: "100%", height: heightPx, pointerEvents: "none" }}>
                  {/* Bottom edge line for every page */}
                  <div
                    style={{
                      position: "absolute",
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: 0,
                      borderBottom: isOverflow
                        ? "3px dashed #ef4444"
                        : "2px dashed #f97316",
                    }}
                  />

                  {/* Page label pill at bottom-right */}
                  <div
                    style={{
                      position: "absolute",
                      bottom: 6,
                      right: 8,
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "1px 6px",
                      borderRadius: 3,
                      background: isOverflow ? "#fef2f2" : "#fff7ed",
                      color: isOverflow ? "#dc2626" : "#c2410c",
                      border: `1px solid ${isOverflow ? "#fecaca" : "#fed7aa"}`,
                    }}
                  >
                    Page {i + 1}{i === totalPages - 1 ? " ends" : ""}
                  </div>

                  {/* Red-tinted overlay on overflow pages */}
                  {isOverflow && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "rgba(239, 68, 68, 0.06)",
                      }}
                    />
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div
            className="flex items-center justify-center text-zinc-400 text-sm bg-white shadow-md"
            style={{ width: widthPx, height: heightPx }}
          >
            {loading ? "Loading preview..." : "Edit JSON to see preview"}
          </div>
        )}
      </div>
    </div>
  )
}
