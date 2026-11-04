export type HistoryRun = {
  id: string
  job_title?: string
  company?: string
  status: string
  created_at: string
  template_id: string
  model_used: string
  job_description: string
  thumb_storage_key?: string
}

export const HISTORY_PAGE_SIZE = 12

/**
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
