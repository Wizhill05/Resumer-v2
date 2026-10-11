"use client"

import { useTheme } from "next-themes"
import { useEffect, useState } from "react"
import { Sun, Moon } from "lucide-react"

export function HeroThemeToggle({ className = "" }: { className?: string }) {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div
        className={`inline-flex h-7 w-7 items-center justify-center text-[var(--fluid-ink)]/60 ${className}`}
        aria-hidden="true"
      >
        <span className="h-3.5 w-3.5 rounded-full bg-current opacity-30" />
      </div>
    )
  }

  const isDark = resolvedTheme === "dark" || theme === "dark"

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={`group inline-flex h-7 w-7 items-center justify-center rounded-none text-[var(--fluid-ink)]/80 transition-colors hover:text-[var(--fluid-ink)] hover:bg-black/5 dark:hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--fluid-ink)] ${className}`}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? (
        <Sun
          size={14}
          className="transition-transform group-hover:rotate-45 group-hover:scale-110"
        />
      ) : (
        <Moon
          size={14}
          className="transition-transform group-hover:-rotate-12 group-hover:scale-110"
        />
      )}
    </button>
  )
}
