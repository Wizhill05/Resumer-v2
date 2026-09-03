"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { useRouter, usePathname } from "next/navigation"
import { Menu, X, Sun, Moon, LayoutDashboard, Sparkles, User, History, LifeBuoy, ChevronRight } from "lucide-react"
import { useTheme } from "next-themes"
import { useSession } from "next-auth/react"
import { useGenerationStats } from "@/components/useGenerationStats"
import { createPortal } from "react-dom"
import { AccountMenu } from "@/components/AccountMenu"

const defaultLinks = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/generate", label: "Generate", icon: Sparkles },
  { href: "/profile", label: "Profile", icon: User },
  { href: "/dashboard/history", label: "History", icon: History },
  { href: "/support", label: "Support", icon: LifeBuoy },
]

function AccountStatsLine() {
  const { data: stats } = useGenerationStats()
  if (!stats) return null
  const leftLabel = stats.cap === null ? "Unlimited" : `${stats.remaining} of ${stats.cap} left today`
  const pct = stats.cap === null ? 100 : Math.min(100, (stats.usedToday / stats.cap) * 100)
  return (
    <span className="mt-1 block">
      <span className="block text-[11px] font-bold text-zinc-500 dark:text-zinc-400">
        {leftLabel}
        <span className="mx-1 text-zinc-300 dark:text-zinc-600">•</span>
        {stats.total} total
      </span>
      <span
        aria-hidden="true"
        className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
      >
        <span
          className="block h-full rounded-full bg-[#ff4e26] transition-all"
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  )
}

export function Nav() {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const { data: session } = useSession()
  const accountUser = session?.user
  const accountInitials = accountUser?.name?.trim()
    ? accountUser.name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("")
    : (accountUser?.email?.trim()[0]?.toUpperCase() ?? "?")

  // Main navbar links — Admin lives in the AccountMenu dropdown only.
  const links = defaultLinks

  useEffect(() => {
    setMounted(true)
  }, [])

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
          {/* Mobile hamburger + theme toggle (account lives inside the menu) */}
          <div className="flex items-center gap-1 md:hidden">
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
              {/* Account — identity entry, opens /account */}
              {accountUser && (
                <div
                  className={closing ? "mobile-nav-item-exit" : "mobile-nav-item"}
                  style={{ animationDelay: closing ? "0ms" : "0ms" }}
                >
                  <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500 mb-2 px-2">
                    Account
                  </p>
                  <button
                    type="button"
                    onClick={() => handleNavigate("/account")}
                    className={`w-full flex items-center gap-3 p-3.5 rounded border transition-all duration-150 active:scale-[0.98] cursor-pointer text-left ${
                      pathname === "/account"
                        ? "border-[#ff4e26] bg-[#ff4e26]/10 font-black shadow-2xs"
                        : "border-zinc-200/60 dark:border-zinc-800/60 bg-white/70 dark:bg-zinc-900/70 hover:border-zinc-300 dark:hover:border-zinc-700 font-bold"
                    }`}
                  >
                    {accountUser.image ? (
                      <img
                        src={accountUser.image}
                        alt=""
                        width={36}
                        height={36}
                        referrerPolicy="no-referrer"
                        className="h-9 w-9 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ff4e26] text-xs font-black text-white"
                      >
                        {accountInitials}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base uppercase tracking-tight text-zinc-800 dark:text-zinc-200">
                        {accountUser.name ?? "Account"}
                      </span>
                      {accountUser.email && (
                        <span className="block truncate text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                          {accountUser.email}
                        </span>
                      )}
                      <AccountStatsLine />
                    </span>
                    <ChevronRight size={15} className="text-zinc-400 dark:text-zinc-600 shrink-0" />
                  </button>
                </div>
              )}
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

            {/* Bottom footer */}
            <div
              className={`pt-5 border-t border-zinc-200 dark:border-zinc-800 mt-6 ${
                closing ? "mobile-nav-item-exit" : "mobile-nav-item"
              }`}
              style={{ animationDelay: closing ? "0ms" : `${(links.length + 1) * 35}ms` }}
            >
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
