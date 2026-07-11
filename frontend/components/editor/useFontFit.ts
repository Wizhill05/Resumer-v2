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

      // Prevent viewport height latching by wrapping all child elements in a temporary div.
      // A standard block div has height auto-calculated solely from its contents, ignoring viewport height.
      const wrapper = doc.createElement("div")
      wrapper.style.position = "relative"
      wrapper.style.display = "flow-root" // contain margins

      const originalNodes = Array.from(body.childNodes)
      originalNodes.forEach((node) => wrapper.appendChild(node))
      body.appendChild(wrapper)

      function setFont(pt: number) {
        root.style.setProperty("--resume-font-size", `${pt}pt`)
        // Small sync reflow: not ideal but binary search is ≤8 iterations
      }

      function measurePages(): number {
        const h = wrapper.getBoundingClientRect().height
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

      let finalFontPt = maxFontSize
      let finalPageCount = 1
      let finalFits = true

      if (bestIdx === null) {
        // Even min overflows
        setFont(steps[0])
        finalFontPt = steps[0]
        finalPageCount = measurePages()
        finalFits = false
      } else {
        setFont(steps[bestIdx])
        finalFontPt = steps[bestIdx]
        finalPageCount = measurePages()
        finalFits = true
      }

      // Restore original body structure
      const restoredNodes = Array.from(wrapper.childNodes)
      restoredNodes.forEach((node) => body.appendChild(node))
      body.removeChild(wrapper)

      setFitState({
        fontPt: finalFontPt,
        pageCount: finalPageCount,
        fits: finalFits,
        searching: false,
      })
    },
    [minFontSize, maxFontSize, targetPages, pageMarginMm, iframeRef]
  )

  return { fitState, runSearch }
}
