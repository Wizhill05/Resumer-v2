"use client"

import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { cn } from "@/lib/utils"
import type { PendingDeletions } from "./api-types"
import { Pill, fetchJson } from "./shared"

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** Current time, refreshed every minute so countdowns stay accurate on an open tab. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

/** "3 days left", "1 day left", "5h left", or "Deleting now" once the deadline has passed. */
export function deletionCountdown(scheduledFor: string, now: number): string {
  const ms = new Date(scheduledFor).getTime() - now
  if (ms <= 0) return "Deleting now"
  if (ms < DAY) return `${Math.ceil(ms / HOUR)}h left`
  const days = Math.ceil(ms / DAY)
  return `${days} ${days === 1 ? "day" : "days"} left`
}

/** Red tint laid over a user row/card that is scheduled for deletion. */
export function DeletionOverlay() {
  return <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-red-500/10 ring-2 ring-inset ring-red-500/50 dark:bg-red-500/15" />
}

export function DeletionPill({ scheduledFor, className }: { scheduledFor: string; className?: string }) {
  const now = useNow()
  return (
    <Pill tone="bad" className={className}>
      <span title={`Permanently deleted ${new Date(scheduledFor).toLocaleString()}`}>{deletionCountdown(scheduledFor, now)}</span>
    </Pill>
  )
}

const CLEANUP_LABELS: Record<string, string> = {
  posthog_person: "PostHog erasure",
  github_grant: "GitHub app revoke",
}

export function PendingDeletionsPanel() {
  const now = useNow()
  const { data } = useQuery<PendingDeletions>({
    queryKey: ["admin", "users", "pending-deletion"],
    queryFn: () => fetchJson<PendingDeletions>("/api/backend/admin/users/pending-deletion"),
    refetchInterval: 60_000,
  })
  if (!data || (data.accounts.length === 0 && data.cleanup.length === 0)) return null

  return (
    <section className="border border-red-300 bg-white dark:border-red-900 dark:bg-zinc-900" aria-labelledby="pending-deletions-heading">
      <header className="flex items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-3 py-2 dark:border-red-900 dark:bg-red-950/40">
        <h2 id="pending-deletions-heading" className="text-xs font-bold text-red-800 dark:text-red-300">
          Scheduled for deletion
        </h2>
        <span className="font-mono text-[11px] text-red-700 dark:text-red-400">{data.accounts.length} account{data.accounts.length === 1 ? "" : "s"}</span>
      </header>

      {data.accounts.length > 0 && (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {data.accounts.map((a) => {
            const soon = new Date(a.deletion_scheduled_for).getTime() - now < 2 * DAY
            return (
              <li key={a.id} className={cn("flex flex-wrap items-center justify-between gap-2 px-3 py-2.5", soon && "bg-red-50/60 dark:bg-red-950/20")}>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-black dark:text-white">{a.name || "No name"}</p>
                  <p className="[overflow-wrap:anywhere] text-[11px] text-zinc-500">
                    {a.email}
                    {a.provider && <span className="ml-1.5 uppercase">· {a.provider}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-right">
                  <p className="text-[11px] text-zinc-500">
                    Requested {new Date(a.deletion_requested_at ?? a.deletion_scheduled_for).toLocaleDateString()}
                    <span className="block">Deletes {new Date(a.deletion_scheduled_for).toLocaleString()}</span>
                  </p>
                  <DeletionPill scheduledFor={a.deletion_scheduled_for} />
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {data.cleanup.length > 0 && (
        <div className="space-y-1 border-t border-zinc-200 px-3 py-2.5 text-[11px] dark:border-zinc-800">
          <p className="font-bold text-zinc-600 dark:text-zinc-300">External cleanup for deleted accounts</p>
          {data.cleanup.map((c) => (
            <p key={`${c.kind}-${c.status}`} className="flex flex-wrap items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
              <Pill tone={c.status === "failed" ? "bad" : "warn"}>{c.status === "failed" ? "Gave up" : "Waiting"}</Pill>
              <span className="font-semibold">{CLEANUP_LABELS[c.kind] ?? c.kind}</span>
              <span className="font-mono">×{c.count}</span>
              {c.last_error && <span className="[overflow-wrap:anywhere] text-zinc-500">· {c.last_error}</span>}
            </p>
          ))}
        </div>
      )}
    </section>
  )
}
