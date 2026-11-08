"use client"

import { useState, useEffect } from "react"
import { usePathname } from "next/navigation"
import { AlertTriangle, X } from "lucide-react"
import { CURRENT_ANNOUNCEMENT } from "./announcementConfig"

export function DynamicAnnouncementModal() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)
  const [secondsRemaining, setSecondsRemaining] = useState(
    CURRENT_ANNOUNCEMENT.lockDurationSeconds
  )

  useEffect(() => {
    if (!CURRENT_ANNOUNCEMENT.enabled) return

    // If targetRoutes includes "*", match everything. Otherwise check exact or subpath.
    const isTargetRoute = CURRENT_ANNOUNCEMENT.targetRoutes.some((route) => {
      if (route === "*") return true
      if (route === "/" && pathname === "/") return true
      return pathname === route || pathname?.startsWith(`${route}/`)
    })

    if (!isTargetRoute) {
      setIsOpen(false)
      return
    }

    try {
      const storageKey = `resumer_announcement_dismissed_${CURRENT_ANNOUNCEMENT.id}`
      const alreadyDismissed = localStorage.getItem(storageKey)
      if (!alreadyDismissed) {
        setIsOpen(true)
        setSecondsRemaining(CURRENT_ANNOUNCEMENT.lockDurationSeconds)
      } else {
        setIsOpen(false)
      }
    } catch {
      // Fallback if localStorage is disabled in privacy mode
      setIsOpen(true)
      setSecondsRemaining(CURRENT_ANNOUNCEMENT.lockDurationSeconds)
    }
  }, [pathname])

  // Countdown timer
  useEffect(() => {
    if (!isOpen || secondsRemaining <= 0) return

    const timer = setInterval(() => {
      setSecondsRemaining((prev) => Math.max(0, prev - 1))
    }, 1000)

    return () => clearInterval(timer)
  }, [isOpen, secondsRemaining])

  const handleDismiss = () => {
    if (secondsRemaining > 0) return
    try {
      const storageKey = `resumer_announcement_dismissed_${CURRENT_ANNOUNCEMENT.id}`
      localStorage.setItem(storageKey, "true")
    } catch {}
    setIsOpen(false)
  }

  if (!isOpen) return null

  const isLocked = secondsRemaining > 0

  return (
    <aside
      aria-label="Important Announcement"
      className="fixed top-2 md:top-4 left-1/2 -translate-x-1/2 z-[9999] w-[min(94vw,56rem)] animate-in slide-in-from-top-6 duration-200"
    >
      <div className="overflow-hidden rounded-md border border-line bg-paper shadow-soft-lg">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-line bg-ember-tint px-3.5 py-2 text-ink">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-ember text-white">
              <AlertTriangle className="h-3.5 w-3.5 stroke-[2.5]" />
            </span>
            <span className="text-xs font-bold">
              System Notice
            </span>
            <span className="hidden sm:inline-block text-xs font-bold opacity-90">
              — {CURRENT_ANNOUNCEMENT.title}
            </span>
          </div>

          {/* Exit button */}
          <button
            type="button"
            onClick={handleDismiss}
            disabled={isLocked}
            aria-label="Close notification"
            className={`flex h-7 w-7 items-center justify-center rounded-md border border-line transition-colors ${
              isLocked
                ? "cursor-not-allowed bg-ink/10 text-ink-muted opacity-60"
                : "cursor-pointer bg-paper text-ink-muted hover:text-ember hover:border-ember/50"
            }`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Notice Content */}
        <div className="p-4 sm:p-5">
          <p className="text-sm font-semibold leading-relaxed text-ink sm:text-base">
            {CURRENT_ANNOUNCEMENT.message}
          </p>

          {/* Bottom control bar */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-line pt-3">
            <div className="text-xs">
              {isLocked ? (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-ink/5 px-2 py-1 font-semibold text-ink-soft">
                  <span className="inline-block h-2 w-2 rounded-full bg-ember animate-pulse" />
                  You can close this in {secondsRemaining}s
                </span>
              ) : (
                <span className="text-ink-muted">
                  Ready to dismiss.
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={handleDismiss}
              disabled={isLocked}
              className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-colors ${
                isLocked
                  ? "cursor-not-allowed bg-ink/10 text-ink-muted"
                  : "cursor-pointer bg-ember text-white hover:bg-[#e03d16] shadow-[0_8px_20px_-10px_rgb(255_78_38/70%)]"
              }`}
            >
              {isLocked ? `Wait ${secondsRemaining}s` : "Got it"}
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}
