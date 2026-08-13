"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Menu, X, Sun, Moon } from "lucide-react"
import { useTheme } from "next-themes"

const defaultLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/generate", label: "Generate" },
  { href: "/profile", label: "Profile" },
  { href: "/dashboard/history", label: "History" },
  { href: "/support", label: "Support" },
]

const ADMIN_CACHE_KEY = "resumer_is_admin"

export function Nav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // Admin status — read from sessionStorage first, then verify in background
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    setMounted(true)

    // Immediately restore cached admin status (no flicker)
    try {
      const cached = sessionStorage.getItem(ADMIN_CACHE_KEY)
      if (cached === "1") setIsAdmin(true)
    } catch {}

    // Background-verify admin access
    fetch("/api/backend/admin/analytics")
      .then((res) => {
        const admin = res.ok
        setIsAdmin(admin)
        try { sessionStorage.setItem(ADMIN_CACHE_KEY, admin ? "1" : "0") } catch {}
      })
      .catch(() => {
        setIsAdmin(false)
        try { sessionStorage.setItem(ADMIN_CACHE_KEY, "0") } catch {}
      })
  }, [])

  const links = isAdmin
    ? [...defaultLinks, { href: "/admin", label: "Admin" }]
    : defaultLinks

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setOpen(false) }, [pathname])

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : ""
    return () => { document.body.style.overflow = "" }
  }, [open])

  const toggleTheme = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark")
  }

  return (
    <>
      <nav className="sticky top-0 z-50 border-b border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 px-4 py-2.5 backdrop-blur md:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link
            href="/dashboard"
            className="resumer-mark px-2.5 py-1 text-base font-black md:text-lg"
          >
            Resumer
          </Link>

          {/* Desktop links */}
          <div className="hidden items-center gap-1 text-sm font-semibold md:flex">
            {links.map((link) => {
              const active = pathname === link.href
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-1.5 transition-colors ${
                    active
                      ? "bg-orange-50 dark:bg-orange-950/50 text-[#ff4e26] dark:text-[#d65235]"
                      : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-black dark:hover:text-white"
                  }`}
                >
                  {link.label}
                </Link>
              )
            })}

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="ml-1 p-2 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-black dark:hover:text-white transition-colors"
              aria-label="Toggle dark mode"
            >
              {mounted && resolvedTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>

          {/* Mobile hamburger + theme toggle */}
          <div className="flex items-center gap-1 md:hidden">
            <button
              onClick={toggleTheme}
              className="p-2 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              aria-label="Toggle dark mode"
            >
              {mounted && resolvedTheme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              onClick={() => setOpen((o) => !o)}
              className="p-2 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
            >
              <span
                className="block transition-all duration-200"
                style={{ opacity: open ? 0 : 1, position: open ? "absolute" : "static" }}
              >
                <Menu size={22} strokeWidth={2} />
              </span>
              <span
                className="block transition-all duration-200"
                style={{ opacity: open ? 1 : 0, position: open ? "static" : "absolute" }}
              >
                <X size={22} strokeWidth={2} />
              </span>
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile menu — rendered outside nav so fixed positioning is clean */}
      {/* Backdrop */}
      <div
        className="md:hidden fixed inset-0 bg-black/20 z-40 transition-opacity duration-200"
        style={{
          top: "49px",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
        }}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      {/* Slide-down panel */}
      <div
        className="fixed left-0 right-0 z-50 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-lg transition-all duration-200 ease-out md:hidden"
        style={{
          top: "49px",
          transform: open ? "translateY(0)" : "translateY(-8px)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
        }}
      >
        {links.map((link) => {
          const active = pathname === link.href
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center border-b border-zinc-100 dark:border-zinc-800 px-4 py-3 text-sm font-semibold transition-colors last:border-b-0 ${
                active
                  ? "border-l-4 border-l-[#ff4e26] dark:border-l-[#d65235] bg-orange-50 dark:bg-orange-950/30 pl-3 text-[#ff4e26] dark:text-[#d65235]"
                  : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 hover:text-black dark:hover:text-white"
              }`}
            >
              {link.label}
            </Link>
          )
        })}
      </div>
    </>
  )
}
