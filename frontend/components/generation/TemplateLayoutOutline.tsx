"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { ZoomIn, ZoomOut, RefreshCw, AlertCircle, Eye } from "lucide-react"
import {
  fetchTemplatePreview,
  type SectionId,
  type TemplatePreviewResponse,
  getCachedOutlinePreview,
  setCachedOutlinePreview,
  clearPreviewCache,
} from "@/lib/template-layout"

export { clearPreviewCache }

type Props = {
  sectionOrder: SectionId[]
  templateId?: string
  templateName?: string
  activeHoverSection?: SectionId | null
  className?: string
  expectedSections?: readonly SectionId[]
}

export function TemplateLayoutOutline({
  sectionOrder,
  templateId = "personal-classic",
  templateName = "Personal Classic",
  className = "",
  expectedSections,
}: Props) {
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(600)
  const canvas = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<TemplatePreviewResponse | null>(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const orderKey = sectionOrder.join(",")

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.min(660, entry.contentRect.width - 32))))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const expectedKey = expectedSections ? expectedSections.join(",") : ""
    const key = `${templateId}:${orderKey}:${expectedKey}`
    const cached = getCachedOutlinePreview(key)
    const timer = setTimeout(async () => {
      setError(false)
      if (cached) { setPreview(cached); return }
      try {
        const data = await fetchTemplatePreview(templateId, sectionOrder, controller.signal, expectedSections)
        if (controller.signal.aborted) return
        setCachedOutlinePreview(key, data)
        setPreview(data)
      } catch {
        if (!controller.signal.aborted) setError(true)
      }
    }, cached ? 0 : 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [templateId, orderKey, sectionOrder, expectedSections, retry])

  const stale = preview && (preview.template_id !== templateId || preview.section_order.join(",") !== orderKey)
  const pageWidth = Math.round(width * zoom)

  return (
    <div className={`flex h-full min-h-0 flex-col bg-ink/5 ${className}`}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-paper px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium"><Eye size={17} className="text-ink-muted" aria-hidden="true" /><span>Sample resume</span></div>
        <div className="flex items-center gap-1 text-ink-muted">
          <button type="button" onClick={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.2) * 10) / 10))} disabled={zoom <= 0.6} aria-label="Zoom preview out" className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-ink/5 disabled:opacity-30 dark:hover:bg-ink/[0.06]"><ZoomOut size={17} /></button>
          <button type="button" onClick={() => setZoom(1)} aria-label="Fit preview to width" className="h-9 min-w-12 rounded-lg px-1 text-xs tabular-nums hover:bg-ink/5 dark:hover:bg-ink/[0.06]">{zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`}</button>
          <button type="button" onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.2) * 10) / 10))} disabled={zoom >= 2} aria-label="Zoom preview in" className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-ink/5 disabled:opacity-30 dark:hover:bg-ink/[0.06]"><ZoomIn size={17} /></button>
        </div>
      </div>
      <p className="shrink-0 px-4 py-2.5 text-xs leading-relaxed text-ink-muted">Sample content. Your resume will use your details.</p>
      {error && <div role="alert" className="mx-4 mb-3 flex shrink-0 items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
        <AlertCircle size={17} className="shrink-0" aria-hidden="true" />
        <span className="flex-1">{preview ? "Could not update the preview. The image shows the previous order." : "Could not load the preview."}</span>
        <button type="button" onClick={() => setRetry((v) => v + 1)} aria-label="Retry preview" className="flex h-11 w-11 shrink-0 items-center justify-center rounded hover:bg-amber-100 dark:hover:bg-amber-900"><RefreshCw size={17} /></button>
      </div>}
      <div ref={canvas} className="min-h-0 flex-1 overflow-auto overscroll-contain px-4 pb-6 pt-1">
        {preview ? <div aria-label={`${templateName} sample resume`} className="mx-auto space-y-5" style={{ width: pageWidth }}>
          {preview.page_images.map((src, index) => <div key={index}>
            <Image unoptimized src={src} alt={`${templateName} sample resume, page ${index + 1}`} width={827} height={1170} draggable={false}
              className={`block h-auto w-full bg-paper shadow-md ${stale && !error ? "opacity-70" : ""}`} />
            {preview.page_count > 1 && <p className="mt-2 text-center text-xs text-ink-muted">Page {index + 1} of {preview.page_count}</p>}
          </div>)}
        </div> : !error && <div role="status" className="mx-auto flex aspect-[210/297] items-center justify-center bg-paper text-sm text-ink-faint shadow-sm" style={{ width: pageWidth }}>Preparing preview…</div>}
      </div>
      {preview?.fit_warning && <p role="status" className="shrink-0 border-t border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">This order takes more than one page with the sample content.</p>}
    </div>
  )
}
