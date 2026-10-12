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
      <div className="border-3 border-black dark:border-zinc-600 bg-[#fbfbf3] dark:bg-zinc-900 shadow-[6px_6px_0px_#000000] dark:shadow-[6px_6px_0px_#ff4e26]">
        {/* Top brutalist bar */}
        <div className="flex items-center justify-between border-b-3 border-black dark:border-zinc-700 bg-yellow-400 dark:bg-[#ff4e26] px-3.5 py-2 text-black dark:text-white">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center border-2 border-black bg-black text-yellow-400 dark:text-white">
              <AlertTriangle className="h-3.5 w-3.5 stroke-[3]" />
            </span>
            <span className="text-xs font-black uppercase tracking-wider">
              System Notice
            </span>
            <span className="hidden sm:inline-block text-xs font-bold opacity-90">
              — {CURRENT_ANNOUNCEMENT.title}
            </span>
          </div>

          {/* Brutalist Exit Button */}
          <button
            type="button"
            onClick={handleDismiss}
            disabled={isLocked}
            aria-label="Close notification"
            className={`flex h-7 w-7 items-center justify-center border-2 border-black transition-all ${
              isLocked
                ? "cursor-not-allowed bg-zinc-200 text-zinc-500 opacity-60 dark:bg-zinc-800 dark:text-zinc-600"
                : "cursor-pointer bg-white text-black shadow-[2px_2px_0px_#000000] hover:bg-zinc-100 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
            }`}
          >
            <X className="h-4 w-4 stroke-[3]" />
          </button>
        </div>

        {/* Notice Content */}
        <div className="p-4 sm:p-5">
          <p className="text-sm font-semibold leading-relaxed text-black dark:text-zinc-100 sm:text-base">
            {CURRENT_ANNOUNCEMENT.message}
          </p>

          {/* Bottom control bar */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t-2 border-dashed border-zinc-300 dark:border-zinc-800 pt-3">
            <div className="text-xs font-bold tracking-tight">
              {isLocked ? (
                <span className="inline-flex items-center gap-1.5 border border-black bg-zinc-100 dark:bg-zinc-800 px-2 py-1 text-black dark:text-zinc-200">
                  <span className="inline-block h-2 w-2 bg-[#ff4e26] animate-pulse" />
                  EXIT LOCKED FOR {secondsRemaining}S
                </span>
              ) : (
                <span className="text-zinc-600 dark:text-zinc-400">
                  Ready to dismiss.
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={handleDismiss}
              disabled={isLocked}
              className={`border-2 border-black px-4 py-1.5 text-xs font-black uppercase tracking-wider transition-all ${
                isLocked
                  ? "cursor-not-allowed border-zinc-400 bg-zinc-200 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-600"
                  : "cursor-pointer bg-[#ff4e26] text-white shadow-[3px_3px_0px_#000000] dark:shadow-[3px_3px_0px_#ffffff] hover:bg-[#e03d16] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
              }`}
            >
              {isLocked ? `WAIT (${secondsRemaining}S)` : "I UNDERSTAND & CLOSE"}
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}
