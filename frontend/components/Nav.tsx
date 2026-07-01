"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Menu, X } from "lucide-react"

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/profile", label: "Profile" },
  { href: "/dashboard/history", label: "History" },
]

export function Nav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setOpen(false) }, [pathname])

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : ""
    return () => { document.body.style.overflow = "" }
  }, [open])

  return (
    <>
      <nav className="sticky top-0 z-50 border-b border-zinc-200 bg-white/95 px-4 py-2.5 backdrop-blur md:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link
            href="/dashboard"
            className="border border-zinc-900 bg-yellow-300 px-2.5 py-1 text-base font-extrabold uppercase tracking-tight md:text-lg"
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
                    active ? "bg-orange-50 text-[#ff4e26]" : "text-zinc-600 hover:bg-zinc-50 hover:text-black"
                  }`}
                >
                  {link.label}
                </Link>
              )
            })}
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setOpen((o) => !o)}
            className="p-2 transition-colors hover:bg-zinc-100 md:hidden"
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
        className="fixed left-0 right-0 z-50 border-b border-zinc-200 bg-white shadow-lg transition-all duration-200 ease-out md:hidden"
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
              className={`flex items-center border-b border-zinc-100 px-4 py-3 text-sm font-semibold transition-colors last:border-b-0 ${
                active
                  ? "border-l-4 border-l-[#ff4e26] bg-orange-50 pl-3 text-[#ff4e26]"
                  : "text-zinc-700 hover:bg-zinc-50 hover:text-black"
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
