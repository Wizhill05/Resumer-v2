"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useRouter, usePathname } from "next/navigation"
import { Menu, X, Sun, Moon, LogOut, LayoutDashboard, Sparkles, User, History, LifeBuoy, Shield, ArrowUpRight } from "lucide-react"
import { useTheme } from "next-themes"
import { createPortal } from "react-dom"
import { useCallback } from "react"

const defaultLinks = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/generate", label: "Generate", icon: Sparkles },
  { href: "/profile", label: "Profile", icon: User },
  { href: "/dashboard/history", label: "History", icon: History },
  { href: "/support", label: "Support", icon: LifeBuoy },
]

const ADMIN_CACHE_KEY = "resumer_is_admin"

export function Nav() {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
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
    ? [...defaultLinks, { href: "/admin", label: "Admin", icon: Shield }]
    : defaultLinks
  const handleClose = useCallback(() => {
    if (!open || closing) return
    setClosing(true)
    setTimeout(() => {
      setOpen(false)
      setClosing(false)
    }, 200)
  }, [open, closing])

  const handleNavigate = (href: string) => {
    if (pathname === href) {
      handleClose()
      return
    }
    setClosing(true)
    setTimeout(() => {
      router.push(href)
      setOpen(false)
      setClosing(false)
    }, 180)
  }

  const handleOpen = () => {
    setClosing(false)
    setOpen(true)
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    setOpen(false)
    setClosing(false)
  }, [pathname])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose()
    }
    if (open) {
      window.addEventListener("keydown", handleKeyDown)
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      document.body.style.overflow = ""
    }
  }, [open, handleClose])
  const toggleTheme = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark")
  }

  return (
    <>
      <nav className="sticky top-0 z-50 border-b border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-900/95 px-4 py-2.5 backdrop-blur md:px-6">
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
                      ? "bg-orange-50 dark:bg-orange-950/50 text-[#ff4e26]"
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
              className="ml-1 p-2 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-black dark:hover:text-white transition-colors cursor-pointer"
              aria-label="Toggle dark mode"
            >
              {mounted && resolvedTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            {/* Sign Out Button */}
            <form action="/api/auth/signout" method="POST" className="ml-1">
              <button
                type="submit"
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-zinc-500 dark:text-zinc-400 hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer"
                title="Sign Out"
              >
                <LogOut size={14} />
                <span>Sign Out</span>
              </button>
            </form>
          </div>
          {/* Mobile hamburger + theme toggle */}
          <div className="flex items-center gap-2 md:hidden">
            <button
              onClick={toggleTheme}
              className="p-1.5 border-2 border-black dark:border-zinc-700 bg-white dark:bg-zinc-800 text-black dark:text-white shadow-[2px_2px_0px_#000000] dark:shadow-[2px_2px_0px_#3f3f46] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all cursor-pointer"
              aria-label="Toggle dark mode"
            >
              {mounted && resolvedTheme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button
              onClick={handleOpen}
              className="p-1.5 border-2 border-black dark:border-zinc-700 bg-[#ff4e26] text-white shadow-[2px_2px_0px_#000000] dark:shadow-[2px_2px_0px_#3f3f46] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all cursor-pointer"
              aria-label="Open menu"
              aria-expanded={open}
            >
              <Menu size={20} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </nav>

      {/* Fullscreen Mobile Hamburger Menu Overlay (Neo-Brutalist) */}
      {open && mounted && createPortal(
        <div
          className={`fixed inset-0 z-[100] flex flex-col bg-[#fbfbf3] dark:bg-[#18181b] app-bg text-black dark:text-white md:hidden select-none ${
            closing ? "neo-menu-exit" : "neo-menu-enter"
          }`}
          role="dialog"
          aria-modal="true"
          aria-label="Mobile Navigation Menu"
        >
          {/* Top Bar Header */}
          <div className="flex shrink-0 items-center justify-between border-b-2 border-black dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 shadow-[0_3px_0px_#000000] dark:shadow-[0_3px_0px_#27272a]">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleNavigate("/dashboard")}
                className="resumer-mark px-2.5 py-1 text-base font-black active:translate-x-[1px] active:translate-y-[1px] cursor-pointer"
              >
                Resumer
              </button>
              <span className="font-mono text-[10px] font-extrabold border-2 border-black dark:border-zinc-700 bg-yellow-300 dark:bg-zinc-800 text-black dark:text-zinc-200 px-1.5 py-0.5 shadow-[2px_2px_0px_#000000] dark:shadow-none">
                [MENU]
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={toggleTheme}
                className="flex items-center justify-center p-2 border-2 border-black dark:border-zinc-700 bg-white dark:bg-zinc-800 text-black dark:text-white shadow-[2px_2px_0px_#000000] dark:shadow-[2px_2px_0px_#3f3f46] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all cursor-pointer"
                aria-label="Toggle dark mode"
              >
                {resolvedTheme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
              </button>
              <button
                onClick={handleClose}
                className="flex items-center justify-center p-2 border-2 border-black dark:border-zinc-700 bg-[#ff4e26] text-white shadow-[2px_2px_0px_#000000] dark:shadow-[2px_2px_0px_#3f3f46] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all cursor-pointer"
                aria-label="Close menu"
              >
                <X size={18} strokeWidth={3} />
              </button>
            </div>
          </div>

          {/* Directory Navigation Body */}
          <div className="flex-1 overflow-y-auto px-4 py-5 flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex items-center justify-between font-mono text-[11px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400 px-1 pb-1 border-b-2 border-black/15 dark:border-zinc-800">
                <span>// DIRECTORY</span>
                <span>[TAP TO ROUTE]</span>
              </div>

              <div className="space-y-2.5 pt-1">
                {links.map((link, idx) => {
                  const active = pathname === link.href
                  const Icon = link.icon
                  const indexStr = String(idx + 1).padStart(2, "0")
                  return (
                    <div
                      key={link.href}
                      className="neo-item-enter"
                      style={{ animationDelay: `${idx * 35}ms` }}
                    >
                      <button
                        type="button"
                        onClick={() => handleNavigate(link.href)}
                        className={`w-full flex items-center justify-between p-3.5 border-2 transition-all cursor-pointer text-left ${
                          active
                            ? "border-black dark:border-zinc-400 bg-[#ff4e26] text-white shadow-[4px_4px_0px_#000000] dark:shadow-[4px_4px_0px_#ff4e26] font-black"
                            : "border-black dark:border-zinc-700 bg-white dark:bg-zinc-900 text-black dark:text-zinc-100 shadow-[3px_3px_0px_#000000] dark:shadow-[3px_3px_0px_#27272a] hover:bg-zinc-50 dark:hover:bg-zinc-800/80 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none font-extrabold"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className={`font-mono text-xs font-black ${active ? "text-white/80" : "text-[#ff4e26]"}`}>
                            [{indexStr}]
                          </span>
                          <Icon size={18} className={active ? "text-white" : "text-black dark:text-zinc-300"} />
                          <span className="text-base uppercase tracking-tight truncate">
                            {link.label}
                          </span>
                        </div>

                        {active ? (
                          <span className="font-mono text-[10px] font-black uppercase tracking-wider bg-black text-white px-2 py-0.5 border border-white/40 shadow-xs">
                            ACTIVE
                          </span>
                        ) : (
                          <ArrowUpRight size={16} className="text-zinc-400 dark:text-zinc-500 shrink-0" />
                         )}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Bottom Actions & Status Footer */}
            <div className="neo-item-enter pt-4 mt-6 border-t-2 border-black/15 dark:border-zinc-800 space-y-2.5" style={{ animationDelay: `${links.length * 35}ms` }}>
              <form action="/api/auth/signout" method="POST">
                <button
                  type="submit"
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 text-xs font-black uppercase tracking-wider text-white bg-black dark:bg-zinc-900 border-2 border-black dark:border-zinc-700 shadow-[3px_3px_0px_#ff4e26] dark:shadow-[3px_3px_0px_#000000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all cursor-pointer"
                >
                  <LogOut size={15} />
                  <span>Sign Out</span>
                </button>
              </form>

              <div className="flex items-center justify-between border-2 border-black dark:border-zinc-700 bg-yellow-300 dark:bg-zinc-800 p-2 text-black dark:text-zinc-200 shadow-[2px_2px_0px_#000000] dark:shadow-none font-mono text-[10px] font-extrabold uppercase">
                <span>RESUMER v2.0</span>
                <span>ATS OPTIMIZED</span>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
