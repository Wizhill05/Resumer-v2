"use client"

import { cn } from "@/lib/utils"
import type { LlmEndpoint } from "./types"
import { formatLatency, relativeTime, secondsUntil, useNow } from "./format"

export type HealthKind = "disabled" | "token" | "cooling" | "error" | "ok" | "unknown"

export type HealthView = {
  kind: HealthKind
  label: string
  detail: string
}

/** Priority: disabled > token problem > cooling > error > ok > unknown. */
export function computeHealth(endpoint: LlmEndpoint, now: number): HealthView {
  const { health } = endpoint
  const checked = health.checked_at ? `Checked ${relativeTime(health.checked_at, now)}` : "Never checked"
  const errMsg = health.error?.message ? ` · ${health.error.message}` : ""
  const lastAuthFailed = health.error?.code === "unauthorized" || health.error?.code === "missing_api_key"

  if (!endpoint.enabled) {
    return { kind: "disabled", label: "Disabled", detail: "Skipped by routing until re-enabled" }
  }
  if (endpoint.api_key_status === "undecryptable") {
    return { kind: "token", label: "Re-enter token", detail: "Stored token can't be decrypted (server secret changed). Routing skips this endpoint." }
  }
  if (endpoint.api_key_status === "missing" && lastAuthFailed) {
    return { kind: "token", label: "Token needed", detail: `${checked}${errMsg}` }
  }
  const cooling = secondsUntil(health.cooldown_until, now)
  if (cooling > 0) {
    return { kind: "cooling", label: `Cooling ${cooling}s`, detail: `Paused after an auth/rate-limit error; retried in ${cooling}s${errMsg}` }
  }
  if (health.status === "error") {
    return { kind: "error", label: "Error", detail: `${checked}${errMsg}` }
  }
  if (health.status === "ok") {
    const lat = health.latency_ms !== null ? ` · ${formatLatency(health.latency_ms)}` : ""
    return { kind: "ok", label: "Healthy", detail: `${checked}${lat}` }
  }
  return { kind: "unknown", label: "Unchecked", detail: "Run a test or refresh models to check" }
}

const TONE: Record<HealthKind, { dot: string; box: string }> = {
  ok: {
    dot: "bg-emerald-500",
    box: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  },
  error: {
    dot: "bg-red-500",
    box: "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300",
  },
  token: {
    dot: "bg-red-500",
    box: "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300",
  },
  cooling: {
    dot: "bg-amber-500 animate-pulse",
    box: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  },
  disabled: {
    dot: "bg-zinc-400",
    box: "border-zinc-300 bg-zinc-100 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
  },
  unknown: {
    dot: "bg-zinc-300 dark:bg-zinc-600 ring-1 ring-inset ring-zinc-400",
    box: "border-zinc-300 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400",
  },
}

export function HealthDot({ kind, className }: { kind: HealthKind; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2 w-2 shrink-0 rounded-full", TONE[kind].dot, className)} />
}

export function HealthBadge({ endpoint, className }: { endpoint: LlmEndpoint; className?: string }) {
  const cooling = !!endpoint.health.cooldown_until
  const now = useNow(cooling ? 1000 : 30_000)
  const view = computeHealth(endpoint, now)
  return (
    <span
      title={view.detail}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase leading-none tracking-wide",
        TONE[view.kind].box,
        className,
      )}
    >
      <HealthDot kind={view.kind} />
      {view.label}
      <span className="sr-only">. {view.detail}</span>
    </span>
  )
}
