"use client"

import type { ReactNode } from "react"
import { RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    if (res.status === 401) throw new Error("Unauthorized")
    if (res.status === 403) throw new Error("Access Denied")
    throw new Error(`Failed to load ${url}`)
  }
  return res.json()
}

export async function sendJson<T = unknown>(url: string, method: string, body?: unknown, failure = "Request failed"): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(failure)
  return res.json()
}

export function formatDuration(seconds?: number | null): string {
  if (seconds === null || seconds === undefined) return "--"
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const mins = Math.floor(seconds / 60)
  const remSecs = Math.round(seconds % 60)
  return `${mins}m ${remSecs < 10 ? "0" : ""}${remSecs}s`
}

export function formatCompact(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value)
}

export function formatNumber(value: number): string {
  return value.toLocaleString("en")
}

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("panel-strong min-w-0 p-4 sm:p-5", className)}>{children}</section>
}

export function PanelHeader({
  title,
  icon,
  aside,
  hint,
}: {
  title: string
  icon?: ReactNode
  aside?: ReactNode
  hint?: string
}) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-1 border-b border-zinc-200 pb-2 dark:border-zinc-700">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-zinc-800 dark:text-zinc-200">
          {icon}
          <span className="min-w-0 break-words">{title}</span>
        </h2>
        {hint && <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">{hint}</p>}
      </div>
      {aside}
    </div>
  )
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <h2 className="font-mono text-[11px] font-bold uppercase tracking-widest text-[#ff4e26]">{children}</h2>
      {aside}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("soft-skeleton animate-pulse", className)} aria-hidden="true" />
}

export function Note({ tone = "neutral", children }: { tone?: "neutral" | "error" | "warn"; children: ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : undefined}
      className={cn(
        "border p-3 text-xs leading-5",
        tone === "neutral" && "border-dashed border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400",
        tone === "error" && "border-red-300 bg-red-50 font-semibold text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300",
        tone === "warn" && "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
      )}
    >
      {children}
    </p>
  )
}

const PILL_TONES = {
  neutral: "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  good: "border-green-300 bg-green-100 text-green-800 dark:border-green-800 dark:bg-green-950/60 dark:text-green-300",
  bad: "border-red-300 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300",
  warn: "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  brand: "border-orange-300 bg-orange-100 text-orange-800 dark:border-orange-800 dark:bg-orange-950/60 dark:text-orange-300",
}

export function Pill({ tone = "neutral", children, className }: { tone?: keyof typeof PILL_TONES; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase leading-none", PILL_TONES[tone], className)}>
      {children}
    </span>
  )
}

export function statusTone(status: string): keyof typeof PILL_TONES {
  if (status === "completed") return "good"
  if (status === "failed") return "bad"
  if (status === "in_progress" || status === "pending") return "warn"
  return "neutral"
}

export function Delta({ current, previous, suffix = "" }: { current: number; previous: number; suffix?: string }) {
  if (previous === 0 && current === 0) return <span className="text-zinc-400">no change</span>
  if (previous === 0) return <span className="text-zinc-500">new activity</span>
  const pct = ((current - previous) / previous) * 100
  const flat = Math.abs(pct) < 0.5
  const up = pct > 0
  return (
    <span className={cn("font-semibold", flat ? "text-zinc-500" : up ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400")}>
      {flat ? "flat" : `${up ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)}%`}
      {suffix && <span className="font-normal text-zinc-500"> {suffix}</span>}
    </span>
  )
}

export function Stat({
  label,
  value,
  sub,
  accent,
  spark,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  accent?: boolean
  spark?: ReactNode
}) {
  return (
    <div className="panel-strong min-w-0 p-3 sm:p-4">
      <p className="truncate text-[10px] font-extrabold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className={cn("mt-1 truncate text-2xl font-black tabular-nums sm:text-3xl", accent ? "text-[#ff4e26]" : "text-black dark:text-white")}>{value}</p>
      {sub && <p className="mt-1 text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">{sub}</p>}
      {spark && <div className="mt-2">{spark}</div>}
    </div>
  )
}

export function RefreshButton({ onClick, busy, label = "Refresh" }: { onClick: () => void; busy?: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 border border-zinc-300 bg-white px-3 text-xs font-bold text-zinc-700 transition-colors hover:border-black hover:text-black disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-white dark:hover:text-white"
    >
      <RefreshCw size={14} className={busy ? "animate-spin text-[#ff4e26]" : ""} />
      {label}
    </button>
  )
}

/** Segmented control that stays thumb-sized on a phone. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "min-h-11 min-w-12 cursor-pointer px-3 text-xs font-bold transition-colors sm:min-h-9",
            option.value === value
              ? "bg-[#ff4e26] text-white"
              : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export const FIELD_CLASS =
  "min-h-11 w-full border border-zinc-300 bg-white px-3 text-sm text-black outline-none focus-visible:border-[#ff4e26] focus-visible:ring-2 focus-visible:ring-[#ff4e26]/30 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white sm:min-h-9 sm:text-xs"
