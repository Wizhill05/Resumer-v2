"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export type PdfPreview = {
  pageImages: string[]
  fontSize: number
  pageCount: number
  fitWarning: boolean
}

/**
 * Debounces edits before asking the server for the actual WeasyPrint output.
 *
 * This deliberately previews PDF page rasters rather than estimating pages
 * from browser HTML. The displayed page boundary is therefore the one used by
 * Export PDF, including font metrics and page-break rules.
 */
export function useDebouncedHtmlPreview({
  genId,
  resume,
  profile,
  enabled = true,
  debounceMs = 650,
}: {
  genId: string
  resume: Record<string, unknown> | null
  profile: Record<string, unknown> | null
  enabled?: boolean
  debounceMs?: number
}) {
  const [preview, setPreview] = useState<PdfPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchPreview = useCallback(
    (res: Record<string, unknown>, prof: Record<string, unknown> | null) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setLoading(true)
      setError(null)

      fetch(`/api/backend/generate/${genId}/render-pdf-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume: res, profile: prof }),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Render failed: ${response.status}`)
          return response.json()
        })
        .then((data: {
          page_images: string[]
          font_size: number
          page_count: number
          fit_warning: boolean
        }) => {
          setPreview({
            pageImages: data.page_images,
            fontSize: data.font_size,
            pageCount: data.page_count,
            fitWarning: data.fit_warning,
          })
          setLoading(false)
        })
        .catch((reason: unknown) => {
          if (reason instanceof Error && reason.name === "AbortError") return
          setError(reason instanceof Error ? reason.message : "Preview error")
          setLoading(false)
        })
    },
    [genId]
  )

  useEffect(() => {
    if (!enabled || !resume) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => fetchPreview(resume, profile), debounceMs)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [enabled, resume, profile, debounceMs, fetchPreview])

  useEffect(() => () => abortRef.current?.abort(), [])

  return { preview, loading, error }
}
