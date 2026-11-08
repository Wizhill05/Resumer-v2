"use client"

import { useState } from "react"
import Link from "next/link"
import { LogOut, Copy, Check, User, Shield, LifeBuoy, Bot, ChevronRight } from "lucide-react"
import { PageHero } from "@/components/PageHero"
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

  const links = [
    { href: "/profile", icon: User, title: "Résumé profile", desc: "Experience, projects, skills" },
    { href: "/support", icon: LifeBuoy, title: "Support", desc: "Bugs, questions, feature requests" },
    { href: "/agent", icon: Bot, title: "Connect an agent", desc: "Use Résumer from Claude Code, Codex and more" },
    ...(isAdmin ? [{ href: "/admin", icon: Shield, title: "Admin", desc: "Analytics, users, limits" }] : []),
  ]

  return (
    <>
      <PageHero
        title={
          <span className="flex flex-col items-center gap-3 md:flex-row md:gap-5">
            {image ? (
              <img
                src={image}
                alt=""
                width={72}
                height={72}
                referrerPolicy="no-referrer"
                className="h-14 w-14 shrink-0 rounded-full border-[3px] border-paper object-cover shadow-[0_10px_24px_-8px_rgb(255_78_38/45%)] md:h-[4.5rem] md:w-[4.5rem]"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-[3px] border-paper bg-gradient-to-br from-[#ff7d5c] to-[#ff4e26] text-lg font-bold tracking-normal text-white shadow-[0_10px_24px_-8px_rgb(255_78_38/55%)] md:h-[4.5rem] md:w-[4.5rem] md:text-2xl"
              >
                {initials(name, email)}
              </span>
            )}
            <span className="min-w-0 max-w-full truncate">{name ?? "Account"}</span>
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center justify-center gap-2 md:justify-start">
            {email && <span className="break-all">{email}</span>}
            <span className="rounded border border-line bg-paper/70 px-1.5 py-0.5 text-xs font-semibold text-ink-soft">
              {providerLabel(provider)}
            </span>
          </span>
        }
        actions={
          <form action={signOutAction}>
            <button
              type="submit"
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-paper/70 px-4 text-sm font-semibold text-ink backdrop-blur-sm transition-colors hover:border-red-500/50 hover:text-red-600"
            >
              <LogOut size={16} aria-hidden="true" />
              Sign out
            </button>
          </form>
        }
      />

      <div className="page-wrap flex-1">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="soft-card p-6 md:p-7" aria-labelledby="usage-heading">
            <h2 id="usage-heading" className="text-sm font-semibold text-ink-muted">Daily usage</h2>
            <p className="mt-3 flex items-end gap-2.5">
              <span className="text-6xl font-bold leading-[0.85] tracking-tight text-ink">
                {stats ? (stats.cap === null ? "∞" : stats.remaining ?? "–") : "–"}
              </span>
              <span className="pb-1 text-base text-ink-soft">
                {stats?.cap === null ? "unlimited builds" : `of ${stats?.cap ?? DAILY_GENERATION_CAP} builds left today`}
              </span>
            </p>
            <div
              role="progressbar"
              aria-label="Daily generation usage"
              aria-valuemin={0}
              aria-valuemax={stats?.cap ?? 100}
              aria-valuenow={stats?.usedToday ?? 0}
              className="mt-5 h-2 w-full overflow-hidden rounded-full bg-ink/10"
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#ffb199] to-[#ff4e26] transition-all"
                style={{ width: `${100 - pct}%` }}
              />
            </div>
            <dl className="mt-5 grid grid-cols-3 border-t border-line pt-4">
              {[
                [stats ? stats.usedToday : "–", "used today"],
                [stats ? stats.thisMonth : "–", "this month"],
                [stats ? stats.total : "–", "all time"],
              ].map(([value, label], i) => (
                <div key={label} className={i ? "border-l border-line pl-4" : ""}>
                  <dd className="text-2xl font-semibold tracking-tight text-ink">{value}</dd>
                  <dt className="text-xs text-ink-muted">{label}</dt>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-ink-muted">
              {isAdmin
                ? "Admin account — daily and monthly caps bypassed."
                : `${DAILY_GENERATION_CAP} free generations per rolling 24 hours.`}
            </p>
          </section>

          <div className="min-w-0 space-y-5">
            <section className="soft-card p-5">
              <h2 className="text-sm font-semibold text-ink-muted">Login email</h2>
              {email ? (
                <div className="mt-2 flex items-center gap-2">
                  <p className="min-w-0 flex-1 select-all break-all text-[15px] font-semibold text-ink">{email}</p>
                  <button
                    type="button"
                    onClick={copyEmail}
                    aria-label="Copy email"
                    className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-line text-ink-soft transition-colors hover:border-ink/30 hover:text-ink"
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              ) : (
                <p className="mt-2 text-sm text-ink-muted">No email on file for this login.</p>
              )}
            </section>

            <nav aria-label="Account links" className="soft-card divide-y divide-line overflow-hidden">
              {links.map(({ href, icon: Icon, title, desc }) => (
                <Link key={href} href={href} className="group flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-ember-tint/40">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-ember-tint text-ember">
                    <Icon size={15} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">{title}</span>
                    <span className="block truncate text-xs text-ink-muted">{desc}</span>
                  </span>
                  <ChevronRight size={15} aria-hidden="true" className="text-ink-faint transition-transform group-hover:translate-x-0.5" />
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </div>
    </>
  )
}
