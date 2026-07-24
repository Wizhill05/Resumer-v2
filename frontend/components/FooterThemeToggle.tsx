"use client"

import { useTheme } from "next-themes"
import { useEffect, useState } from "react"
import { Sun, Moon } from "lucide-react"

export function FooterThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div className="h-8 w-24 border-2 border-black dark:border-zinc-700 bg-white dark:bg-zinc-900 animate-pulse" />
    )
  }

  const isDark = theme === "dark"

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="inline-flex items-center gap-2 border-2 border-black dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 py-1.5 text-xs font-mono font-bold uppercase text-zinc-900 dark:text-zinc-100 shadow-[2px_2px_0px_#000000] dark:shadow-[2px_2px_0px_#3f3f46] transition-all hover:-translate-y-0.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 active:translate-y-0"
      aria-label="Toggle Theme"
    >
      {isDark ? (
        <>
          <Sun size={14} className="text-amber-400" />
          <span>LIGHT MODE</span>
        </>
      ) : (
        <>
          <Moon size={14} className="text-indigo-600" />
          <span>DARK MODE</span>
        </>
      )}
    </button>
  )
}
