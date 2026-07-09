"use client"

import { useCallback, useRef, useState } from "react"

// A4 page height at 96dpi.
// body.scrollHeight includes @media screen padding that simulates @page margins,
// so the budget is the full A4 page height — padding is part of the measured height.
const A4_HEIGHT_PX = (297 / 25.4) * 96

function a4ContentHeightPx(_pageMarginMm: number): number {
  return A4_HEIGHT_PX
}

function quantizeRange(min: number, max: number, step = 0.05): number[] {
  const n = Math.max(1, Math.round((max - min) / step))
  const arr: number[] = []
  for (let i = 0; i <= n; i++) {
    arr.push(Math.round((min + i * step) * 10000) / 10000)
  }
  if (arr[arr.length - 1] < max - step / 2) arr.push(Math.round(max * 10000) / 10000)
  return arr
}

export type FitState = {
  fontPt: number
  pageCount: number
  fits: boolean
  searching: boolean
}

/**
 * Client-side font-size binary search over an A4 iframe.
 *
 * Usage:
 *   const { fitState, runSearch } = useFontFit({ manifest, iframeRef })
 *
 *   After new HTML loads into the iframe, call runSearch().
 *   The hook sets --resume-font-size on the iframe's root and measures
 *   content height to estimate page count.
 */
export function useFontFit({
  minFontSize,
  maxFontSize,
  targetPages,
  pageMarginMm,
  iframeRef,
}: {
  minFontSize: number
  maxFontSize: number
  targetPages: number
  pageMarginMm: number
  iframeRef: React.RefObject<HTMLIFrameElement | null>
}) {
  const [fitState, setFitState] = useState<FitState>({
    fontPt: maxFontSize,
    pageCount: 1,
    fits: true,
    searching: false,
  })

  const runSearch = useCallback(
    (currentFontPt?: number) => {
      const iframe = iframeRef.current
      if (!iframe || !iframe.contentDocument) return

      setFitState((s) => ({ ...s, searching: true }))

      const budgetPx = a4ContentHeightPx(pageMarginMm)
      const steps = quantizeRange(minFontSize, maxFontSize)
      const doc = iframe.contentDocument
      const root = doc.documentElement
      const body = doc.body

      function setFont(pt: number) {
        root.style.setProperty("--resume-font-size", `${pt}pt`)
        // Small sync reflow: not ideal but binary search is ≤8 iterations
      }

      function measurePages(): number {
        const h = body.scrollHeight
        return Math.max(1, Math.ceil(h / budgetPx - 1e-6))
      }

      // Discrete binary search
      let lo = 0
      let hi = steps.length - 1
      let bestIdx: number | null = null

      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        setFont(steps[mid])
        const pages = measurePages()
        if (pages <= targetPages) {
          bestIdx = mid
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }

      if (bestIdx === null) {
        // Even min overflows
        setFont(steps[0])
        const pages = measurePages()
        setFitState({ fontPt: steps[0], pageCount: pages, fits: false, searching: false })
      } else {
        setFont(steps[bestIdx])
        const pages = measurePages()
        setFitState({ fontPt: steps[bestIdx], pageCount: pages, fits: true, searching: false })
      }
    },
    [minFontSize, maxFontSize, targetPages, pageMarginMm, iframeRef]
  )

  return { fitState, runSearch }
}
