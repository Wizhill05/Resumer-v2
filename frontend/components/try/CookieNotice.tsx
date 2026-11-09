"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

const DISMISSED_KEY = "resumer_cookie_notice_dismissed"

export function CookieNotice() {
  const [mounted, setMounted] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    setMounted(true)
    try {
      if (window.localStorage.getItem(DISMISSED_KEY) === "1") {
        setDismissed(true)
      }
    } catch {
      // localStorage may be unavailable. Keep the notice visible.
    }
  }, [])

  if (!mounted || dismissed) return null

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1")
    } catch {
      // Ignore storage errors. The banner still dismisses for this session.
    }
    setDismissed(true)
  }

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      className="fixed left-3 right-3 bottom-[84px] z-40 rounded-md border border-line bg-paper px-4 py-3 text-ink-soft shadow-soft md:bottom-4 md:left-4 md:right-auto md:max-w-[22rem]"
    >
      <div className="flex items-end justify-between gap-3">
        <p className="text-xs leading-snug">
          We use one essential cookie to track your 5 free résumés.{" "}
          <Link href="/privacy" className="underline">
            Privacy
          </Link>
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 cursor-pointer rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-paper hover:opacity-90"
        >
          Got it
        </button>
      </div>
    </div>
  )
}
