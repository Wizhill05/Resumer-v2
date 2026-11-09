"use client"

import { useCallback, useEffect, useRef, useState } from "react"

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string | undefined
  reset: (id: string) => void
  remove: (id: string) => void
}

function turnstileApi(): TurnstileApi | undefined {
  if (typeof window === "undefined") return undefined
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile
}

const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js"

// Turnstile only accepts these sizes. "Invisible" is a widget mode chosen per
// site key in the Cloudflare dashboard, not a size, so pass appearance
// "interaction-only" to keep the widget hidden unless a click is needed.
export type TurnstileSize = "normal" | "compact" | "flexible"
export type TurnstileAppearance = "always" | "execute" | "interaction-only"

/**
 * Shared Turnstile hook for guest flows.
 *
 * Mirrors the support form integration: loads the Cloudflare script once,
 * renders a widget into a host div, and tracks the single-use token.
 * Returns a `reset` that clears the token and asks Turnstile for a fresh
 * challenge. When no site key is configured the hook is inert and the
 * backend skips verification.
 */
export function useTurnstile(
  options: { siteKey?: string; size?: TurnstileSize; appearance?: TurnstileAppearance; enabled?: boolean } = {},
) {
  const size = options.size ?? "flexible"
  const appearance = options.appearance ?? "always"
  const enabled = options.enabled ?? true
  const siteKey = options.siteKey ?? process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""
  const needsTurnstile = enabled && Boolean(siteKey)

  const [token, setTokenState] = useState("")
  const tokenRef = useRef("")
  const waitersRef = useRef<((value: string) => void)[]>([])
  const setToken = useCallback((next: string) => {
    tokenRef.current = next
    setTokenState(next)
    if (next) {
      const waiters = waitersRef.current
      waitersRef.current = []
      waiters.forEach((resolve) => resolve(next))
    }
  }, [])
  const hostRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!needsTurnstile) return
    let cancelled = false
    const host = hostRef.current
    if (!host) return

    function renderWidget() {
      const api = turnstileApi()
      if (cancelled || !api || widgetIdRef.current) return
      const widgetId = api.render(host!, {
        sitekey: siteKey,
        size,
        appearance,
        callback: (next: string) => setToken(next),
        "expired-callback": () => setToken(""),
        "error-callback": () => setToken(""),
        "timeout-callback": () => setToken(""),
      })
      widgetIdRef.current = widgetId ?? null
    }

    let script = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SRC}"]`)
    if (!script) {
      script = document.createElement("script")
      script.src = TURNSTILE_SRC
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }
    script.addEventListener("load", renderWidget)
    renderWidget()
    const loadedScript = script

    return () => {
      cancelled = true
      loadedScript.removeEventListener("load", renderWidget)
      const widgetId = widgetIdRef.current
      widgetIdRef.current = null
      if (widgetId) {
        try {
          turnstileApi()?.remove(widgetId)
        } catch {}
      }
      setToken("")
    }
  }, [needsTurnstile, siteKey, size, appearance, setToken])

  function reset() {
    setToken("")
    const widgetId = widgetIdRef.current
    if (!widgetId) return
    try {
      turnstileApi()?.reset(widgetId)
    } catch {}
  }

  /** Resolve with the current token, or wait up to `timeoutMs` for one. Empty string on timeout. */
  function getToken(timeoutMs = 10000): Promise<string> {
    if (!needsTurnstile) return Promise.resolve("")
    if (tokenRef.current) return Promise.resolve(tokenRef.current)
    return new Promise((resolve) => {
      const done = (value: string) => { clearTimeout(timer); resolve(value) }
      const timer = setTimeout(() => {
        waitersRef.current = waitersRef.current.filter((w) => w !== done)
        resolve("")
      }, timeoutMs)
      waitersRef.current.push(done)
    })
  }

  return { token, needsTurnstile, reset, getToken, hostRef, siteKey }
}

export function TurnstileHost({
  hostRef,
  needsTurnstile,
  className,
}: {
  hostRef: React.RefObject<HTMLDivElement | null>
  needsTurnstile: boolean
  className?: string
}) {
  if (!needsTurnstile) return null
  return <div ref={hostRef} className={className} aria-label="Human check" />
}
