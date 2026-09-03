"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { useRouter, usePathname } from "next/navigation"
import { Menu, X, Sun, Moon, LogOut, LayoutDashboard, Sparkles, User, History, LifeBuoy, Shield, ChevronRight } from "lucide-react"
import { useTheme } from "next-themes"
import { createPortal } from "react-dom"
import { signOutAction } from "@/app/actions"
import { AccountMenu } from "@/components/AccountMenu"

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

            {/* Sign Out Button -> Account section */}
            <AccountMenu />
          </div>
          {/* Mobile account + hamburger + theme toggle */}
          <div className="flex items-center gap-1 md:hidden">
            <AccountMenu />
            <button
              onClick={toggleTheme}
              className="p-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors cursor-pointer"
              aria-label="Toggle dark mode"
            >
              {mounted && resolvedTheme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              onClick={handleOpen}
              className="p-2 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-all active:scale-90 cursor-pointer"
              aria-label="Open menu"
              aria-expanded={open}
            >
              <Menu size={22} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </nav>

      {/* Fullscreen Mobile Hamburger Menu Overlay */}
      {open && mounted && createPortal(
        <div
          className={`fixed inset-0 z-[100] flex flex-col bg-[#fbfbf3] dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 md:hidden ${
            closing ? "mobile-nav-exit" : "mobile-nav-enter"
          }`}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation Menu"
        >
          {/* Top Bar inside Fullscreen Overlay */}
          <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-4 py-3 bg-white/80 dark:bg-zinc-900/80 backdrop-blur">
            <button
              type="button"
              onClick={() => handleNavigate("/dashboard")}
              className="resumer-mark px-2.5 py-1 text-base font-black transition-transform active:scale-95 cursor-pointer"
            >
              Resumer
            </button>

            <div className="flex items-center gap-1">
              <button
                onClick={toggleTheme}
                className="p-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 rounded transition-all active:scale-90 cursor-pointer"
                aria-label="Toggle dark mode"
              >
                {resolvedTheme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
              </button>
              <button
                onClick={handleClose}
                className="p-2 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 rounded transition-all active:scale-90 cursor-pointer"
                aria-label="Close menu"
              >
                <X size={22} strokeWidth={2.5} />
              </button>
            </div>
          </div>

          {/* Navigation Links Area */}
          <div className="flex-1 overflow-y-auto px-4 py-5 flex flex-col justify-between">
            <div className="space-y-1.5">
              <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500 mb-2 px-2">
                Navigation
              </p>
              {links.map((link, idx) => {
                const active = pathname === link.href
                const Icon = link.icon
                return (
                  <div
                    key={link.href}
                    className={closing ? "mobile-nav-item-exit" : "mobile-nav-item"}
                    style={{ animationDelay: closing ? "0ms" : `${(idx + 1) * 35}ms` }}
                  >
                    <button
                      type="button"
                      onClick={() => handleNavigate(link.href)}
                      className={`w-full flex items-center justify-between p-3.5 rounded border transition-all duration-150 active:scale-[0.98] cursor-pointer text-left ${
                        active
                          ? "border-[#ff4e26] bg-[#ff4e26]/10 text-[#ff4e26] font-black shadow-2xs"
                          : "border-zinc-200/60 dark:border-zinc-800/60 bg-white/70 dark:bg-zinc-900/70 text-zinc-800 dark:text-zinc-200 hover:border-zinc-300 dark:hover:border-zinc-700 font-bold"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Icon size={18} className={active ? "text-[#ff4e26]" : "text-zinc-400 dark:text-zinc-500"} />
                        <span className="text-base uppercase tracking-tight truncate">{link.label}</span>
                      </div>
                      {active ? (
                        <span className="text-[10px] font-mono font-bold uppercase text-[#ff4e26] bg-[#ff4e26]/15 px-2 py-0.5 rounded">
                          Active
                        </span>
                      ) : (
                        <ChevronRight size={15} className="text-zinc-400 dark:text-zinc-600 shrink-0" />
                      )}
                    </button>
                  </div>
                )
              })}
            </div>

            {/* Bottom Actions */}
            <div
              className={`pt-5 border-t border-zinc-200 dark:border-zinc-800 mt-6 space-y-3 ${
                closing ? "mobile-nav-item-exit" : "mobile-nav-item"
              }`}
              style={{ animationDelay: closing ? "0ms" : `${(links.length + 1) * 35}ms` }}
            >
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 text-xs font-extrabold uppercase tracking-wider text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-950/40 rounded transition-all active:scale-[0.98] cursor-pointer"
                >
                  <LogOut size={14} />
                  Sign Out
                </button>
              </form>

              <div className="flex items-center justify-between px-1 text-[10px] font-mono text-zinc-400 dark:text-zinc-500">
                <span>Resumer v2.0</span>
                <span>ATS Optimized</span>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
