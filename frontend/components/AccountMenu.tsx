"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import {
  User,
  Shield,
  Settings,
  LogOut,
  ChevronDown,
  Copy,
  Check,
} from "lucide-react"
import { signOutAction } from "@/app/actions"
import { LoginModal } from "@/components/LoginModal"
import { useIsAdmin } from "@/components/useIsAdmin"

function initials(name?: string | null, email?: string | null) {
  if (name?.trim()) {
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("")
  }
  if (email?.trim()) return email.trim()[0]?.toUpperCase() ?? "?"
  return "?"
}

function providerLabel(provider?: string) {
  if (provider === "github") return "GitHub"
  if (provider === "google") return "Google"
  return provider ? provider[0].toUpperCase() + provider.slice(1) : "OAuth"
}

export function AccountMenu() {
  const { data: session, status } = useSession()
  const isAdmin = useIsAdmin()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open ])

  if (status === "loading") {
    return (
      <div
        className="h-8 w-8 animate-pulse rounded-full border border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800"
        aria-label="Loading account"
      />
    )
  }

  if (!session?.user) {
    return <LoginModal triggerClassName="ml-1" callbackUrl="/dashboard" />
  }

  const user = session.user
  const provider =
    (session as { provider?: string }).provider ??
    (user as { provider?: string }).provider
  const email = user.email ?? ""
  const name = user.name ?? "Account"

  const copyEmail = async () => {
    if (!email) return
    try {
      await navigator.clipboard.writeText(email)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  const menuLinks = [
    { href: "/account", label: "Manage account", icon: Settings },
    { href: "/profile", label: "Resume profile", icon: User },
    // Admin entry is conditional: the overlay nav already lists Admin,
    // the dropdown only shows it to admins to avoid dead ends.
    ...(isAdmin ? [{ href: "/admin", label: "Admin", icon: Shield }] : []),
  ]

  return (
    <div ref={rootRef} className="relative ml-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        title={email || name}
        className="flex cursor-pointer items-center gap-1 rounded-full border border-zinc-300 bg-white p-0.5 pr-1 transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
      >
        {user.image ? (
          // Plain img: OAuth hosts are not in next/image remotePatterns
          <img
            src={user.image}
            alt=""
            width={28}
            height={28}
            referrerPolicy="no-referrer"
            className="h-7 w-7 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-[#ff4e26] text-[11px] font-black text-white"
          >
            {initials(user.name, user.email)}
          </span>
        )}
        <ChevronDown
          size={14}
          className={`text-zinc-500 transition-transform dark:text-zinc-400 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="absolute top-full right-0 z-50 mt-2 w-72 border-2 border-black bg-white shadow-[4px_4px_0px_#000000] dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-[4px_4px_0px_#3f3f46]"
        >
          {/* Identity header */}
          <div className="flex items-start gap-3 border-b border-zinc-200 p-3.5 dark:border-zinc-800">
            {user.image ? (
              <img
                src={user.image}
                alt=""
                width={40}
                height={40}
                referrerPolicy="no-referrer"
                className="h-10 w-10 shrink-0 rounded-full border border-zinc-200 object-cover dark:border-zinc-700"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#ff4e26] text-sm font-black text-white"
              >
                {initials(user.name, user.email)}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-extrabold text-zinc-900 dark:text-zinc-100">
                {name}
              </p>
              {email ? (
                <div className="mt-0.5 flex items-start gap-1">
                  <p
                    className="min-w-0 flex-1 text-xs font-semibold break-all text-zinc-500 select-all dark:text-zinc-400"
                    title={email}
                  >
                    {email}
                  </p>
                  <button
                    type="button"
                    onClick={copyEmail}
                    aria-label="Copy email"
                    title="Copy email"
                    className="shrink-0 cursor-pointer p-0.5 text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-zinc-200"
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </div>
              ) : null}
              <span className="mt-1.5 inline-block border border-zinc-300 px-1.5 py-0.5 text-[10px] font-mono font-bold tracking-wide text-zinc-500 uppercase dark:border-zinc-700 dark:text-zinc-400">
                {providerLabel(provider)}
              </span>
            </div>
          </div>

          {/* Links */}
          <div className="p-1.5">
            {menuLinks.map((link) => {
              const Icon = link.icon
              return (
                <Link
                  key={link.href + link.label}
                  href={link.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 px-2.5 py-2 text-sm font-bold text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-black dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
                >
                  <Icon size={15} className="text-zinc-400 dark:text-zinc-500" />
                  {link.label}
                </Link>
              )
            })}
          </div>

          {/* Sign out */}
          <div className="border-t border-zinc-200 p-1.5 dark:border-zinc-800">
            <form action={signOutAction}>
              <button
                type="submit"
                role="menuitem"
                className="flex w-full cursor-pointer items-center gap-2.5 px-2.5 py-2 text-sm font-bold text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                <LogOut size={15} />
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
