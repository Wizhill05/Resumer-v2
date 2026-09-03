"use client"

import { useQuery } from "@tanstack/react-query"
import { useIsAdmin } from "@/components/useIsAdmin"

export const DAILY_GENERATION_CAP = 5

interface HistoryRun {
  id: string
  status: string
  created_at: string
}

export interface GenerationStats {
  /** Generations started in the last 24h (matches backend rolling window) */
  usedToday: number
  /** Null for admins (backend bypasses the cap) */
  cap: number | null
  /** Null for admins */
  remaining: number | null
  total: number
  thisMonth: number
}

async function fetchRuns(): Promise<HistoryRun[]> {
  const res = await fetch("/api/backend/generate")
  if (!res.ok) throw new Error("Failed to load generations")
  return res.json()
}

/**
 * Derives generation stats from the history list (no dedicated usage
 * endpoint exists). "Today" is a rolling 24h window mirroring the
 * backend's reset_at logic. Admins bypass caps server-side, so their
 * cap/remaining is null (unlimited).
 */
export function useGenerationStats() {
  const isAdmin = useIsAdmin()
  return useQuery({
    // Shared with HistoryClient so the list is fetched once
    queryKey: ["history"],
    queryFn: fetchRuns,
    staleTime: 30_000,
    retry: 1,
    select: (runs): GenerationStats => {
      const now = Date.now()
      const dayAgo = now - 24 * 60 * 60 * 1000
      const monthStart = new Date()
      monthStart.setDate(1)
      monthStart.setHours(0, 0, 0, 0)
      let usedToday = 0
      let thisMonth = 0
      for (const run of runs) {
        const t = new Date(run.created_at).getTime()
        if (Number.isNaN(t)) continue
        if (t >= dayAgo) usedToday += 1
        if (t >= monthStart.getTime()) thisMonth += 1
      }
      const cap = isAdmin ? null : DAILY_GENERATION_CAP
      return {
        usedToday,
        cap,
        remaining: cap === null ? null : Math.max(0, cap - usedToday),
        total: runs.length,
        thisMonth,
      }
    },
  })
}
