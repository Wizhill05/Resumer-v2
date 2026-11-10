"use client"

import Link from "next/link"
import { AlertCircle, ArrowRight, CheckCircle2, Loader2 } from "lucide-react"
import type { GuestRunState } from "@/lib/use-guest-run"

function runTitle(state: GuestRunState): string | null {
  const title = state.run?.job_title?.trim()
  const company = state.run?.company?.trim()
  if (!title) return null
  return company && company !== "Unknown Company" ? `${title} at ${company}` : title
}

/** Compact status of the guest's latest résumé. Links to its result page. */
export function LatestRunCard({ id, state }: { id: string; state: GuestRunState }) {
  const title = runTitle(state)
  const { status } = state
  const done = status === "completed"
  const failed = status === "failed"
  const active = !done && !failed

  const heading = done ? "Résumé ready" : failed ? "Generation failed" : status === "loading" ? "Checking your résumé…" : "Generating your résumé"
  const detail = done
    ? title ?? "Open it to download the PDF"
    : failed
      ? "No credit used. Open for details."
      : `${state.stepLabel}… ${Math.round(state.percent)}%`

  return (
    <Link
      href={`/try/result/${id}`}
      aria-live="polite"
      className={`group relative flex min-w-0 items-center gap-3 overflow-hidden rounded-lg border px-3 py-2 transition-colors ${
        done
          ? "border-emerald-300 bg-emerald-50 hover:bg-emerald-100/70 dark:border-emerald-800 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/60"
          : failed
            ? "border-red-200 bg-red-50 hover:bg-red-100/70 dark:border-red-900 dark:bg-red-950/40"
            : "border-line bg-ink/[0.03] hover:bg-ink/[0.06]"
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          done ? "bg-emerald-500 text-white" : failed ? "bg-red-500 text-white" : "bg-ember-tint text-ember"
        }`}
      >
        {done ? <CheckCircle2 size={15} /> : failed ? <AlertCircle size={15} /> : <Loader2 size={15} className="animate-spin" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-xs font-bold ${done ? "text-emerald-800 dark:text-emerald-300" : failed ? "text-red-700 dark:text-red-400" : "text-ink"}`}>
          {heading}
        </span>
        <span className={`block truncate text-[11px] ${done ? "text-emerald-700 dark:text-emerald-400" : failed ? "text-red-600 dark:text-red-400" : "text-ink-muted"}`}>
          {detail}
        </span>
      </span>
      <span
        className={`flex shrink-0 items-center gap-1 text-[11px] font-bold ${
          done ? "text-emerald-800 dark:text-emerald-300" : failed ? "text-red-700 dark:text-red-400" : "text-ink-muted"
        }`}
      >
        <span className="hidden sm:inline">{done ? "Download" : failed ? "Details" : "View"}</span>
        <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
      </span>
      {active && (
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-ink/5">
          <span className="block h-full bg-ember transition-[width] duration-700 ease-out" style={{ width: `${state.percent}%` }} />
        </span>
      )}
    </Link>
  )
}
