"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { usePathname, useRouter } from "next/navigation"
import { AlertCircle, X } from "lucide-react"
import { authErrorMessage } from "@/lib/auth-errors"

function readAuthError(): string | null {
  try {
    const params = new URLSearchParams(window.location.search)
    return authErrorMessage(params.get("auth_error"), params.get("provider"))
  } catch {
    return null
  }
}

export function AuthErrorBanner() {
  const router = useRouter()
  const pathname = usePathname()
  const [dismissed, setDismissed] = useState(false)
  // The first error seen is kept here: the URL is cleared right after it is
  // shown, so later reads would otherwise come back empty and hide the banner.
  const captured = useRef<string | null>(null)
  const message = useSyncExternalStore(
    () => () => {},
    () => (captured.current ??= readAuthError()),
    () => null,
  )

  // Strip the error from the URL once it is showing so a later attempt (or
  // opening Sign in again) never replays a stale message. Other query params
  // are preserved.
  useEffect(() => {
    if (!message) return
    try {
      const params = new URLSearchParams(window.location.search)
      if (!params.has("auth_error") && !params.has("provider")) return
      params.delete("auth_error")
      params.delete("provider")
      const qs = params.toString()
      router.replace(qs ? `${pathname ?? "/"}?${qs}` : (pathname ?? "/"), { scroll: false })
    } catch {
      router.replace(pathname ?? "/", { scroll: false })
    }
  }, [message, pathname, router])

  if (!message || dismissed) return null

  // The landing nav is fixed (z-50, 44px tall, 16px from the top on md+), so the
  // banner is fixed just below it and above everything else.
  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-[60] px-4 md:top-[4.75rem] md:px-5">
      <div
        role="alert"
        className="pointer-events-auto mx-auto flex w-full max-w-xl items-start gap-2.5 rounded-md border border-amber-300/70 bg-amber-50/90 p-3.5 text-sm text-amber-950 shadow-[0_18px_50px_-24px_rgba(74,32,4,0.55)] backdrop-blur-xl dark:border-amber-500/40 dark:bg-amber-950/85 dark:text-amber-50"
      >
        <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <p className="flex-1 text-sm font-semibold">{message}</p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-amber-100 dark:hover:bg-amber-900 cursor-pointer"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
