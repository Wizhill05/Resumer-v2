/** One History row, as returned by GET /generate/list (no job description). */
export type HistoryRun = {
  id: string
  job_title?: string | null
  company?: string | null
  status: string
  created_at: string
  template_id: string
  thumb_storage_key?: string | null
  /** Bumped by the backend on every editor save; keys the on-device PDF cache. */
  pdf_version?: number
}

/** GET /generate/list envelope. */
export type HistoryPage = {
  items: HistoryRun[]
  next_cursor: string | null
  /** Rows matching the current search. */
  total: number
  /** All of the user's rows, ignoring the search. */
  unfiltered_total: number
}

/** GET /generate/summary. */
export type HistorySummary = {
  total: number
  latest_created_at: string | null
  latest_company: string | null
  latest_job_title: string | null
  used_today: number
  this_month: number
}

/** Query-key roots. Everything lives under ["history"] so one invalidate
 *  (e.g. after generating) refreshes the list and the summary together. */
export const HISTORY_LIST_KEY = ["history", "list"] as const
export const HISTORY_SUMMARY_KEY = ["history", "summary"] as const

export async function fetchHistoryPage(query: string, cursor: string | null): Promise<HistoryPage> {
  const params = new URLSearchParams({ limit: String(HISTORY_PAGE_SIZE) })
  if (query) params.set("q", query)
  if (cursor) params.set("cursor", cursor)
  const res = await fetch(`/api/backend/generate/list?${params}`)
  if (!res.ok) throw new Error("Failed to load history")
  return res.json()
}

export async function fetchHistorySummary(): Promise<HistorySummary> {
  // The server doesn't know the caller's timezone; send the local month start.
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const res = await fetch(`/api/backend/generate/summary?month_start=${encodeURIComponent(monthStart)}`)
  if (!res.ok) throw new Error("Failed to load generations")
  return res.json()
}

/** Rows fetched per page (server max is 100). */
export const HISTORY_PAGE_SIZE = 12

/**
 * Client-side reference for the search semantics. The History page now searches
 * server-side (`q=`, same case-insensitive substring on company / job title).
 *
 * Filter history runs case-insensitive trimmed substring on company or job_title.
 * Returns all runs if the trimmed query is empty.
 */
export function filterHistoryRuns<T extends { company?: string; job_title?: string }>(
  runs: T[],
  query: string
): T[] {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return runs

  return runs.filter((run) => {
    const company = run.company?.toLowerCase() ?? ""
    const jobTitle = run.job_title?.toLowerCase() ?? ""
    return company.includes(trimmed) || jobTitle.includes(trimmed)
  })
}
