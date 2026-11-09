"use client"

import { useQuery } from "@tanstack/react-query"
import { useIsAdmin } from "@/components/useIsAdmin"
import {
  fetchHistorySummary,
  HISTORY_SUMMARY_KEY,
  type HistorySummary,
} from "@/lib/history"

export const DAILY_GENERATION_CAP = 5

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

/** Shared by the dashboard History tile and the nav/account usage stats. */
export function useHistorySummary<T = HistorySummary>(select?: (summary: HistorySummary) => T) {
  return useQuery({
    queryKey: HISTORY_SUMMARY_KEY,
    queryFn: fetchHistorySummary,
    staleTime: 30_000,
    retry: 1,
    select,
  })
}

/**
 * Generation stats from GET /generate/summary (server-side aggregates, so the
 * full history list is never downloaded for a counter). "Today" is a rolling
 * 24h window mirroring the backend's reset_at logic. Admins bypass caps
 * server-side, so their cap/remaining is null (unlimited).
 */
export function useGenerationStats() {
  const isAdmin = useIsAdmin()
  return useHistorySummary((summary): GenerationStats => {
    const cap = isAdmin ? null : DAILY_GENERATION_CAP
    return {
      usedToday: summary.used_today,
      cap,
      remaining: cap === null ? null : Math.max(0, cap - summary.used_today),
      total: summary.total,
      thisMonth: summary.this_month,
    }
  })
}
