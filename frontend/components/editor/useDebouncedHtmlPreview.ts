"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export function useDebouncedHtmlPreview({
  genId,
  resume,
  profile,
  fontSizePt,
  enabled = true,
  debounceMs = 400,
}: {
  genId: string
  resume: Record<string, unknown> | null
  profile: Record<string, unknown> | null
  fontSizePt?: number
  enabled?: boolean
  debounceMs?: number
}) {
  const [html, setHtml] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetch_ = useCallback(
    (res: Record<string, unknown>, prof: Record<string, unknown> | null, fs?: number) => {
      if (abortRef.current) abortRef.current.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl

      setLoading(true)
      setError(null)

      fetch(`/api/backend/generate/${genId}/render-html`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume: res, profile: prof, font_size: fs ?? null }),
        signal: ctrl.signal,
      })
        .then(async (r) => {
          if (!r.ok) throw new Error(`Render failed: ${r.status}`)
          return r.json()
        })
        .then((data: { html: string }) => {
          setHtml(data.html)
          setLoading(false)
        })
        .catch((e: unknown) => {
          if (e instanceof Error && e.name === "AbortError") return
          setError(e instanceof Error ? e.message : "Preview error")
          setLoading(false)
        })
    },
    [genId]
  )

  useEffect(() => {
    if (!enabled || !resume) return

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      fetch_(resume, profile, fontSizePt)
    }, debounceMs)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [enabled, resume, profile, fontSizePt, debounceMs, fetch_])

  return { html, loading, error }
}
