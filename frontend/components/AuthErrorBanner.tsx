"use client"

import { useState, useSyncExternalStore } from "react"
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

function useAuthError(): string | null {
  return useSyncExternalStore(() => () => {}, readAuthError, () => null)
}

export function AuthErrorBanner() {
  const router = useRouter()
  const pathname = usePathname()
  const [dismissed, setDismissed] = useState(false)
  const authError = useAuthError()

  if (!authError || dismissed) return null

  const dismiss = () => {
    setDismissed(true)
    try {
      const params = new URLSearchParams(window.location.search)
      params.delete("auth_error")
      params.delete("provider")
      const qs = params.toString()
      router.replace(qs ? `${pathname ?? "/"}?${qs}` : (pathname ?? "/"))
    } catch {
      router.replace(pathname ?? "/")
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-5 pt-6">
      <div
        role="alert"
        className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
      >
        <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <p className="flex-1 text-sm font-semibold">{authError}</p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-amber-100 dark:hover:bg-amber-900 cursor-pointer"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
