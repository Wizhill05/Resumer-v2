"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import type { PDFDocumentLoadingTask, PDFPageProxy, RenderTask } from "pdfjs-dist"
import { Loader2, Maximize2, ZoomIn, ZoomOut } from "lucide-react"

/**
 * Renders a PDF with pdf.js and lets the reader pan and zoom it like a map:
 * mouse wheel / trackpad pinch / touch pinch zoom around the pointer, drag
 * (mouse or one finger) pans, double-click or double-tap toggles a close-up.
 * Pages are re-rasterised at the settled zoom so text stays sharp.
 */

const CSS_PX_PER_PT = 96 / 72
const PAGE_GAP = 24
const PAD = 16
const MIN_ZOOM = 0.2
const MAX_ZOOM = 5
// Backing-store ceiling per canvas; iOS refuses canvases above ~16.7 MP.
const MAX_CANVAS_PIXELS = 12_000_000

type Link = { href: string; left: number; top: number; width: number; height: number }
type PageInfo = { page: PDFPageProxy; width: number; height: number; links: Link[] }
type View = { s: number; x: number; y: number }

let workerReady = false
async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist")
  if (!workerReady) {
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(
      new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
      { type: "module" }
    )
    workerReady = true
  }
  return pdfjs
}

async function describePage(page: PDFPageProxy): Promise<PageInfo> {
  const viewport = page.getViewport({ scale: CSS_PX_PER_PT })
  const annotations = await page.getAnnotations({ intent: "display" }).catch(() => [])
  const links: Link[] = []
  for (const a of annotations as Array<{ subtype?: string; url?: string; rect?: number[] }>) {
    if (a.subtype !== "Link" || !a.url || !a.rect) continue
    if (!/^(https?:|mailto:|tel:)/i.test(a.url)) continue
    const [x1, y1] = viewport.convertToViewportPoint(a.rect[0], a.rect[1]) as number[]
    const [x2, y2] = viewport.convertToViewportPoint(a.rect[2], a.rect[3]) as number[]
    links.push({
      href: a.url,
      left: Math.min(x1, x2),
      top: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    })
  }
  return { page, width: viewport.width, height: viewport.height, links }
}

function PageCanvas({ info, zoom, label }: { info: PageInfo; zoom: number; label: string }) {
  const holder = useRef<HTMLDivElement>(null)
  const [painted, setPainted] = useState(false)

  useEffect(() => {
    const el = holder.current
    if (!el) return
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
    const area = info.width * info.height
    const raster = Math.min(zoom * dpr, Math.sqrt(MAX_CANVAS_PIXELS / area))
    const viewport = info.page.getViewport({ scale: CSS_PX_PER_PT * raster })
    const canvas = document.createElement("canvas")
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    canvas.className = "absolute inset-0 block h-full w-full"
    canvas.setAttribute("aria-hidden", "true")
    let task: RenderTask | null = null
    let cancelled = false
    // Render off to the side and swap in when done so zooming never flashes blank.
    const timer = window.setTimeout(() => {
      task = info.page.render({ canvas, viewport, background: "#ffffff" })
      task.promise
        .then(() => {
          if (cancelled) return
          el.replaceChildren(canvas)
          setPainted(true)
        })
        .catch(() => {
          /* cancelled by a newer zoom level */
        })
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      task?.cancel()
    }
  }, [info, zoom])

  return (
    <div
      role="img"
      aria-label={label}
      className="relative overflow-hidden rounded-[3px] bg-white shadow-soft-lg ring-1 ring-black/10"
      style={{ width: info.width, height: info.height }}
    >
      <div ref={holder} className="absolute inset-0" />
      {!painted && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="animate-spin text-ember" size={28} aria-hidden="true" />
        </div>
      )}
      {info.links.map((link, i) => (
        <a
          key={i}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          title={link.href}
          data-pdf-link=""
          draggable={false}
          className="absolute rounded-[2px] transition-colors hover:bg-ember/15 focus-visible:outline-2 focus-visible:outline-ember"
          style={{ left: link.left, top: link.top, width: link.width, height: link.height }}
        >
          <span className="sr-only">{link.href}</span>
        </a>
      ))}
    </div>
  )
}

export function PdfViewer({ data, title }: { data: Blob; title: string }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const zoomLabelRef = useRef<HTMLSpanElement>(null)
  const [pages, setPages] = useState<PageInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [rasterZoom, setRasterZoom] = useState(1)

  const view = useRef<View>({ s: 1, x: 0, y: 0 })
  const fitted = useRef(true) // still at the automatic fit; refit on resize
  const settleTimer = useRef<number | null>(null)
  const animTimer = useRef<number | null>(null)
  const docSize = useRef({ w: 0, h: 0, firstH: 0 })

  // ── Load the document (parents remount via `key` for a new file) ─────
  useEffect(() => {
    let cancelled = false
    let task: PDFDocumentLoadingTask | null = null
    ;(async () => {
      const pdfjs = await loadPdfjs()
      const bytes = new Uint8Array(await data.arrayBuffer())
      if (cancelled) return
      task = pdfjs.getDocument({ data: bytes })
      const doc = await task.promise
      const loaded = await Promise.all(
        Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1).then(describePage))
      )
      if (!cancelled) setPages(loaded)
    })().catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Could not open this PDF")
    })
    return () => {
      cancelled = true
      void task?.destroy()
    }
  }, [data])

  // ── View maths ───────────────────────────────────────────────────────
  const clampView = useCallback((v: View): View => {
    const vp = viewportRef.current
    if (!vp) return v
    const vw = vp.clientWidth
    const vh = vp.clientHeight
    const s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.s))
    const cw = docSize.current.w * s
    const ch = docSize.current.h * s
    const x = cw + PAD * 2 <= vw ? (vw - cw) / 2 : Math.min(PAD, Math.max(vw - cw - PAD, v.x))
    const y = ch + PAD * 2 <= vh ? (vh - ch) / 2 : Math.min(PAD, Math.max(vh - ch - PAD, v.y))
    return { s, x, y }
  }, [])

  const apply = useCallback(
    (next: View, opts: { animate?: boolean } = {}) => {
      const v = clampView(next)
      view.current = v
      const el = contentRef.current
      if (el) {
        if (animTimer.current) window.clearTimeout(animTimer.current)
        el.style.transition = opts.animate ? "transform 220ms cubic-bezier(0.2, 0, 0, 1)" : "none"
        if (opts.animate) animTimer.current = window.setTimeout(() => { el.style.transition = "none" }, 240)
        el.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.s})`
      }
      // Written straight to the DOM: this runs on every wheel tick and pointer move.
      if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${Math.round(v.s * 100)}%`
      if (settleTimer.current) window.clearTimeout(settleTimer.current)
      settleTimer.current = window.setTimeout(() => setRasterZoom(view.current.s), 160)
    },
    [clampView]
  )

  const fitScale = useCallback(() => {
    const vp = viewportRef.current
    if (!vp || !docSize.current.w) return 1
    const byWidth = (vp.clientWidth - PAD * 2) / docSize.current.w
    // Desktop: the whole first page in view. Phones: fill the width.
    if (vp.clientWidth < 768) return byWidth
    const byHeight = (vp.clientHeight - PAD * 2) / docSize.current.firstH
    return Math.min(byWidth, byHeight)
  }, [])

  const fit = useCallback(
    (animate = false) => {
      fitted.current = true
      apply({ s: fitScale(), x: 0, y: PAD }, { animate })
    },
    [apply, fitScale]
  )

  const zoomAt = useCallback(
    (nextScale: number, px: number, py: number, animate = false) => {
      const v = view.current
      const s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextScale))
      const cx = (px - v.x) / v.s
      const cy = (py - v.y) / v.s
      fitted.current = false
      apply({ s, x: px - cx * s, y: py - cy * s }, { animate })
    },
    [apply]
  )

  const zoomByButton = useCallback(
    (factor: number) => {
      const vp = viewportRef.current
      if (!vp) return
      zoomAt(view.current.s * factor, vp.clientWidth / 2, vp.clientHeight / 2, true)
    },
    [zoomAt]
  )

  // Size the document and fit once pages are known.
  useLayoutEffect(() => {
    if (!pages.length) return
    docSize.current = {
      w: Math.max(...pages.map((p) => p.width)),
      h: pages.reduce((sum, p) => sum + p.height, 0) + PAGE_GAP * (pages.length - 1),
      firstH: pages[0].height,
    }
    fit()
  }, [pages, fit])

  // Keep the view sensible when the window or orientation changes.
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp || !pages.length) return
    const ro = new ResizeObserver(() => {
      if (fitted.current) fit()
      else apply(view.current)
    })
    ro.observe(vp)
    return () => ro.disconnect()
  }, [pages, fit, apply])

  // ── Input: wheel, pointers (drag + pinch), double-tap, keys ──────────
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp || !pages.length) return

    const local = (clientX: number, clientY: number) => {
      const r = vp.getBoundingClientRect()
      return { x: clientX - r.left, y: clientY - r.top }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      let dy = e.deltaY
      if (e.deltaMode === 1) dy *= 16
      else if (e.deltaMode === 2) dy *= vp.clientHeight
      // ctrlKey marks a trackpad pinch, whose deltas are much smaller.
      const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015))
      const p = local(e.clientX, e.clientY)
      zoomAt(view.current.s * Math.min(2, Math.max(0.5, factor)), p.x, p.y)
    }

    const pointers = new Map<number, { x: number; y: number }>()
    let start = { s: 1, x: 0, y: 0, px: 0, py: 0, dist: 1 }
    let moved = false
    let suppressClick = false
    let lastTap = { t: 0, x: 0, y: 0 }

    const resetStart = () => {
      const pts = [...pointers.values()]
      const v = view.current
      if (pts.length >= 2) {
        const [a, b] = pts
        start = { ...v, px: (a.x + b.x) / 2, py: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1 }
      } else if (pts.length === 1) {
        start = { ...v, px: pts[0].x, py: pts[0].y, dist: 1 }
      }
    }

    const toggleCloseUp = (x: number, y: number) => {
      const fitS = fitScale()
      if (view.current.s < fitS * 1.4) zoomAt(Math.max(fitS * 2.2, 1.4), x, y, true)
      else fit(true)
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return
      pointers.set(e.pointerId, local(e.clientX, e.clientY))
      if (pointers.size === 1) {
        moved = false
        suppressClick = false
      }
      resetStart()
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return
      pointers.set(e.pointerId, local(e.clientX, e.clientY))
      const pts = [...pointers.values()]
      if (pts.length >= 2) {
        const [a, b] = pts
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
        const mx = (a.x + b.x) / 2
        const my = (a.y + b.y) / 2
        const s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, start.s * (dist / start.dist)))
        const cx = (start.px - start.x) / start.s
        const cy = (start.py - start.y) / start.s
        moved = true
        fitted.current = false
        apply({ s, x: mx - cx * s, y: my - cy * s })
        return
      }
      const p = pts[0]
      const dx = p.x - start.px
      const dy = p.y - start.py
      if (!moved && Math.hypot(dx, dy) < 5) return
      if (!moved) {
        moved = true
        vp.setPointerCapture?.(e.pointerId)
        vp.dataset.dragging = ""
      }
      fitted.current = false
      apply({ s: start.s, x: start.x + dx, y: start.y + dy })
    }

    const onPointerUp = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return
      const p = pointers.get(e.pointerId)!
      pointers.delete(e.pointerId)
      if (vp.hasPointerCapture?.(e.pointerId)) vp.releasePointerCapture(e.pointerId)
      if (moved) suppressClick = true
      if (pointers.size === 0) {
        delete vp.dataset.dragging
        if (!moved && e.pointerType !== "mouse" && e.type === "pointerup") {
          const now = performance.now()
          if (now - lastTap.t < 300 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) {
            toggleCloseUp(p.x, p.y)
            lastTap = { t: 0, x: 0, y: 0 }
          } else {
            lastTap = { t: now, x: p.x, y: p.y }
          }
        }
      } else {
        resetStart()
      }
    }

    const onClickCapture = (e: MouseEvent) => {
      if (!suppressClick) return
      e.preventDefault()
      e.stopPropagation()
      suppressClick = false
    }

    const onDblClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-pdf-link]")) return
      const p = local(e.clientX, e.clientY)
      toggleCloseUp(p.x, p.y)
    }

    const onKey = (e: KeyboardEvent) => {
      const v = view.current
      const step = 80
      switch (e.key) {
        case "+":
        case "=":
          zoomByButton(1.25)
          break
        case "-":
        case "_":
          zoomByButton(0.8)
          break
        case "0":
          fit(true)
          break
        case "ArrowUp":
          apply({ ...v, y: v.y + step }, { animate: true })
          break
        case "ArrowDown":
          apply({ ...v, y: v.y - step }, { animate: true })
          break
        case "ArrowLeft":
          apply({ ...v, x: v.x + step }, { animate: true })
          break
        case "ArrowRight":
          apply({ ...v, x: v.x - step }, { animate: true })
          break
        case "PageDown":
        case " ":
          apply({ ...v, y: v.y - vp.clientHeight * 0.85 }, { animate: true })
          break
        case "PageUp":
          apply({ ...v, y: v.y + vp.clientHeight * 0.85 }, { animate: true })
          break
        default:
          return
      }
      e.preventDefault()
    }

    // Stop Safari's own page pinch-zoom from fighting ours.
    const blockGesture = (e: Event) => e.preventDefault()

    vp.addEventListener("wheel", onWheel, { passive: false })
    vp.addEventListener("pointerdown", onPointerDown)
    vp.addEventListener("pointermove", onPointerMove)
    vp.addEventListener("pointerup", onPointerUp)
    vp.addEventListener("pointercancel", onPointerUp)
    vp.addEventListener("click", onClickCapture, true)
    vp.addEventListener("dblclick", onDblClick)
    vp.addEventListener("keydown", onKey)
    vp.addEventListener("gesturestart", blockGesture)
    vp.addEventListener("gesturechange", blockGesture)
    return () => {
      vp.removeEventListener("wheel", onWheel)
      vp.removeEventListener("pointerdown", onPointerDown)
      vp.removeEventListener("pointermove", onPointerMove)
      vp.removeEventListener("pointerup", onPointerUp)
      vp.removeEventListener("pointercancel", onPointerUp)
      vp.removeEventListener("click", onClickCapture, true)
      vp.removeEventListener("dblclick", onDblClick)
      vp.removeEventListener("keydown", onKey)
      vp.removeEventListener("gesturestart", blockGesture)
      vp.removeEventListener("gesturechange", blockGesture)
    }
  }, [pages, apply, fit, fitScale, zoomAt, zoomByButton])

  useEffect(
    () => () => {
      if (settleTimer.current) window.clearTimeout(settleTimer.current)
      if (animTimer.current) window.clearTimeout(animTimer.current)
    },
    []
  )

  const controlButton =
    "flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-ink/5 hover:text-ember focus-visible:outline-2 focus-visible:outline-ember"

  return (
    <div className="relative h-full w-full">
      <div
        ref={viewportRef}
        tabIndex={0}
        role="region"
        aria-label={`${title}. Scroll or pinch to zoom, drag to move, double-click to zoom in.`}
        className="relative h-full w-full touch-none select-none overflow-hidden outline-none cursor-grab data-[dragging]:cursor-grabbing focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ember/40"
      >
        {pages.length > 0 && (
          <div
            ref={contentRef}
            className="absolute left-0 top-0 flex origin-top-left flex-col items-center will-change-transform"
            style={{ gap: PAGE_GAP }}
          >
            {pages.map((info, i) => (
              <PageCanvas
                key={i}
                info={info}
                zoom={rasterZoom}
                label={`${title}, page ${i + 1} of ${pages.length}`}
              />
            ))}
          </div>
        )}
        {!pages.length && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-ink-muted">
            <Loader2 className="animate-spin text-ember" size={32} aria-hidden="true" />
            <span className="text-xs" role="status">Opening PDF…</span>
          </div>
        )}
        {error && (
          <div role="alert" className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-ink-muted">
            {error}
          </div>
        )}
      </div>

      {pages.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4 pb-[env(safe-area-inset-bottom)]">
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-line bg-paper/90 p-1 shadow-soft-lg backdrop-blur-xl">
            <button type="button" onClick={() => zoomByButton(0.8)} className={controlButton} aria-label="Zoom out" title="Zoom out (−)">
              <ZoomOut size={16} aria-hidden="true" />
            </button>
            <span ref={zoomLabelRef} className="w-12 text-center text-xs font-semibold tabular-nums text-ink-soft">
              100%
            </span>
            <button type="button" onClick={() => zoomByButton(1.25)} className={controlButton} aria-label="Zoom in" title="Zoom in (+)">
              <ZoomIn size={16} aria-hidden="true" />
            </button>
            <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
            <button type="button" onClick={() => fit(true)} className={controlButton} aria-label="Fit to screen" title="Fit to screen (0)">
              <Maximize2 size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
