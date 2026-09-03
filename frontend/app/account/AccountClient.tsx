"use client"

import { useState } from "react"
import Link from "next/link"
import { LogOut, Copy, Check, User, Shield } from "lucide-react"
import { signOutAction } from "@/app/actions"
import { DAILY_GENERATION_CAP, useGenerationStats } from "@/components/useGenerationStats"
import { useIsAdmin } from "@/components/useIsAdmin"

interface AccountClientProps {
  name: string | null
  email: string | null
  image: string | null
  provider: string | null
}

function initials(name: string | null, email: string | null) {
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

function providerLabel(provider: string | null) {
  if (provider === "github") return "GitHub"
  if (provider === "google") return "Google"
  if (provider) return provider[0].toUpperCase() + provider.slice(1)
  return "OAuth"
}

export function AccountClient({ name, email, image, provider }: AccountClientProps) {
  const [copied, setCopied] = useState(false)
  const { data: stats } = useGenerationStats()
  const isAdmin = useIsAdmin()
  const pct =
    !stats || stats.cap === null
      ? 100
      : Math.min(100, (stats.usedToday / stats.cap) * 100)

  const copyEmail = async () => {
    if (!email) return
    try {
      await navigator.clipboard.writeText(email)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return (
    <div className="max-w-xl">
      {/* Identity card */}
      <section className="border-2 border-black bg-white p-5 shadow-[5px_5px_0px_#000000] dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-[5px_5px_0px_#3f3f46]">
        <div className="flex items-center gap-4">
          {image ? (
            <img
              src={image}
              alt=""
              width={56}
              height={56}
              referrerPolicy="no-referrer"
              className="h-14 w-14 rounded-full border border-zinc-200 object-cover dark:border-zinc-700"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-[#ff4e26] text-lg font-black text-white"
            >
              {initials(name, email)}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="truncate text-lg font-extrabold tracking-tight">
              {name ?? "Account"}
            </h2>
            <span className="mt-1 inline-block border border-zinc-300 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wide text-zinc-500 uppercase dark:border-zinc-700 dark:text-zinc-400">
              {providerLabel(provider)}
            </span>
          </div>
        </div>

        <div className="mt-4 border-t border-dashed border-zinc-300 pt-4 dark:border-zinc-700">
          <p className="font-mono text-[10px] font-bold tracking-widest text-zinc-500 uppercase dark:text-zinc-400">
            Login email
          </p>
          {email ? (
            <div className="mt-1 flex items-start gap-2">
              <p className="min-w-0 flex-1 text-sm font-bold break-all select-all">
                {email}
              </p>
              <button
                type="button"
                onClick={copyEmail}
                aria-label="Copy email"
                className="shrink-0 cursor-pointer border border-zinc-300 p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-black dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-white"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          ) : (
            <p className="mt-1 text-sm font-semibold text-zinc-500">
              No email on file for this login.
            </p>
          )}
        </div>

        {/* Daily usage with progress bar */}
        <div className="mt-4 border-t border-dashed border-zinc-300 pt-4 dark:border-zinc-700">
          <div className="flex items-baseline justify-between">
            <p className="font-mono text-[10px] font-bold tracking-widest text-zinc-500 uppercase dark:text-zinc-400">
              Daily usage
            </p>
            <p className="text-xs font-extrabold">
              {stats ? (
                stats.cap === null ? (
                  <span className="text-[#ff4e26]">Unlimited</span>
                ) : (
                  <>
                    {stats.usedToday}
                    <span className="text-zinc-400 dark:text-zinc-500"> / {stats.cap}</span>
                  </>
                )
              ) : (
                "–"
              )}
            </p>
          </div>
          <div
            role="progressbar"
            aria-label="Daily generation usage"
            aria-valuemin={0}
            aria-valuemax={stats?.cap ?? 100}
            aria-valuenow={stats?.usedToday ?? 0}
            className="mt-2 h-2.5 w-full overflow-hidden rounded-full border border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800"
          >
            <div
              className="h-full rounded-full bg-[#ff4e26] transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="border border-zinc-200 bg-zinc-50 p-2.5 text-center dark:border-zinc-800 dark:bg-zinc-800/50">
            <p className="text-xl font-black tracking-tight">
              {stats ? (stats.remaining ?? "∞") : "–"}
            </p>
            <p className="mt-0.5 text-[10px] font-bold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              Left today
            </p>
          </div>
          <div className="border border-zinc-200 bg-zinc-50 p-2.5 text-center dark:border-zinc-800 dark:bg-zinc-800/50">
            <p className="text-xl font-black tracking-tight">
              {stats ? stats.thisMonth : "–"}
            </p>
            <p className="mt-0.5 text-[10px] font-bold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              This month
            </p>
          </div>
          <div className="border border-zinc-200 bg-zinc-50 p-2.5 text-center dark:border-zinc-800 dark:bg-zinc-800/50">
            <p className="text-xl font-black tracking-tight">
              {stats ? stats.total : "–"}
            </p>
            <p className="mt-0.5 text-[10px] font-bold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              Total
            </p>
          </div>
        </div>
        <p className="mt-2 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
          {isAdmin
            ? "Admin account — daily and monthly caps bypassed."
            : `${DAILY_GENERATION_CAP} free generations per rolling 24 hours.`}
        </p>

        {/* Linked sections */}
        <div className={`mt-4 grid gap-2 ${isAdmin ? "grid-cols-2" : "grid-cols-1"}`}>
          <Link
            href="/profile"
            className="flex items-center gap-2.5 border-2 border-black bg-white p-3 transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[3px_3px_0px_#000000] dark:border-zinc-700 dark:bg-zinc-900 dark:hover:shadow-[3px_3px_0px_#3f3f46]"
          >
            <User size={16} className="shrink-0 text-zinc-400 dark:text-zinc-500" />
            <span>
              <span className="block text-xs font-black tracking-wide uppercase">Resume profile</span>
              <span className="block text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">Experience, projects, skills</span>
            </span>
          </Link>
          {isAdmin && (
            <Link
              href="/admin"
              className="flex items-center gap-2.5 border-2 border-black bg-white p-3 transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[3px_3px_0px_#000000] dark:border-zinc-700 dark:bg-zinc-900 dark:hover:shadow-[3px_3px_0px_#3f3f46]"
            >
              <Shield size={16} className="shrink-0 text-zinc-400 dark:text-zinc-500" />
              <span>
                <span className="block text-xs font-black tracking-wide uppercase">Admin</span>
                <span className="block text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">Analytics, users, limits</span>
              </span>
            </Link>
          )}
        </div>

        <form action={signOutAction} className="mt-5">
          <button
            type="submit"
            className="flex w-full cursor-pointer items-center justify-center gap-2 border-2 border-red-600 bg-red-50 px-4 py-2.5 text-xs font-black tracking-wider text-red-700 uppercase transition-colors hover:bg-red-100 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/60"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </form>
      </section>
    </div>
  )
}
