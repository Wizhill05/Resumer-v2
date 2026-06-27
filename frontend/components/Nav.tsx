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

  useEffect(() => { setOpen(false) }, [pathname])

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : ""
    return () => { document.body.style.overflow = "" }
  }, [open])

  return (
    <>
      <nav className="border-b border-gray-200 px-6 py-4 bg-white sticky top-0 z-50">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link
            href="/dashboard"
            className="text-xl font-extrabold uppercase border-2 border-black bg-yellow-400 px-3 py-1 shadow-[2px_2px_0px_#000000]"
          >
            Resumer
          </Link>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-6 text-sm font-semibold">
            {links.map((link) => {
              const active = pathname === link.href
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={
                    active
                      ? "text-[#ff4e26]"
                      : "text-zinc-600 hover:text-black transition-colors"
                  }
                >
                  {link.label}
                  {active && (
                    <span className="block h-0.5 bg-[#ff4e26] mt-0.5 rounded-full" />
                  )}
                </Link>
              )
            })}
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setOpen((o) => !o)}
            className="md:hidden p-2 rounded hover:bg-zinc-100 transition-colors"
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
          top: "57px",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
        }}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      {/* Slide-down panel */}
      <div
        className="md:hidden fixed left-0 right-0 bg-white border-b border-gray-200 shadow-lg z-50 transition-all duration-200 ease-out"
        style={{
          top: "57px",
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
              className={`flex items-center px-6 py-4 text-sm font-semibold border-b border-gray-100 last:border-b-0 transition-colors ${
                active
                  ? "text-[#ff4e26] bg-orange-50 border-l-4 border-l-[#ff4e26] pl-5"
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
