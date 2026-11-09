import { z } from "zod"

export const issueSchema = z.object({
  id: z.string(),
  title: z.string().nullable().optional(),
  message: z.string(),
  category: z.string().nullable(),
  status: z.enum(["open", "in_progress", "resolved", "closed"]),
  created_at: z.string(),
  updated_at: z.string().nullable().optional(),
  last_admin_reply_at: z.string().nullable().optional(),
  access_token: z.string().nullable().optional()
})
export const threadSchema = issueSchema.extend({
  viewer_is_admin: z.boolean().optional(),
  user_name: z.string().nullable().optional(),
  user_email: z.string().nullable().optional(),
  email_override: z.string().nullable().optional(),
  generation_id: z.string().nullable().optional(),
  where_happened: z.string().nullable().optional(),
  steps_to_reproduce: z.string().nullable().optional(),
  expected_behavior: z.string().nullable().optional(),
  attachments: z
    .array(
      z.object({
        id: z.string(),
        attachment_type: z.string(),
        filename: z
          .string()
          .nullable()
          .transform((value) => value || "Attachment"),
        transcription: z.string().nullish(),
        presigned_url: z.string().nullable()
      })
    )
    .default([]),
  messages: z
    .array(
      z.object({
        id: z.string(),
        message: z.string(),
        author_role: z.enum(["user", "admin", "system"]),
        created_at: z.string()
      })
    )
    .default([])
})
export type SupportIssue = z.infer<typeof issueSchema>
export type SupportThread = z.infer<typeof threadSchema>
export const createdIssueSchema = z.object({
  id: z.string(),
  access_token: z.string().nullable().optional()
})
const savedIssuesSchema = z.array(z.object({ id: z.string(), token: z.string() }))
const SAVED_ISSUES_KEY = "resumer_support_threads"
const GUEST_TICKET_FLAG = "resumer_has_support_ticket"
/** Event fired on window whenever an issue is marked as seen in this tab. */
export const SUPPORT_SEEN_EVENT = "resumer:support-seen"
export function savedGuestIssues() {
  try {
    return savedIssuesSchema.parse(
      JSON.parse(localStorage.getItem(SAVED_ISSUES_KEY) || "[]")
    )
  } catch {
    return []
  }
}
export function rememberGuestIssue(id: string, token: string) {
  try {
    localStorage.setItem(
      SAVED_ISSUES_KEY,
      JSON.stringify(
        [{ id, token }, ...savedGuestIssues().filter((issue) => issue.id !== id)].slice(0, 30)
      )
    )
  } catch {}
  markGuestTicket()
}
/** Remember that this browser has created or opened a guest ticket. */
export function markGuestTicket() {
  try {
    localStorage.setItem(GUEST_TICKET_FLAG, "1")
  } catch {}
}
/** True when this browser may own guest tickets, so the support list is worth fetching. */
export function hasGuestTicketMarker() {
  try {
    return localStorage.getItem(GUEST_TICKET_FLAG) === "1" || savedGuestIssues().length > 0
  } catch {
    return false
  }
}
export function issueHref(id: string, token?: string | null) {
  return `/support/issues/${encodeURIComponent(id)}${token ? `?access_token=${encodeURIComponent(token)}` : ""}`
}
export const statusLabels = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed"
}
export function issueTitle(issue: SupportIssue) {
  return issue.title || issue.message.split("\n")[0].slice(0, 100)
}
const LAST_SEEN_KEY = "resumer_support_last_seen"
type LastSeenMap = Record<string, string>
export function getLastSeen(): LastSeenMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(LAST_SEEN_KEY) || "{}")
    return typeof parsed === "object" && parsed !== null ? (parsed as LastSeenMap) : {}
  } catch {
    return {}
  }
}
export function markLastSeen(id: string, at: string) {
  try {
    const map = getLastSeen()
    map[id] = at
    localStorage.setItem(LAST_SEEN_KEY, JSON.stringify(map))
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(SUPPORT_SEEN_EVENT, { detail: { id, at } }))
  } catch {}
}
export function hasUnseenReply(issues: Pick<SupportIssue, "id" | "last_admin_reply_at">[]) {
  const seen = getLastSeen()
  return issues.some((issue) => {
    if (!issue.last_admin_reply_at) return false
    const seenAt = seen[issue.id] ? Date.parse(seen[issue.id]) : 0
    return Date.parse(issue.last_admin_reply_at) > seenAt
  })
}
export class SupportFetchError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = "SupportFetchError"
    this.status = status
  }
}
export const SESSION_EXPIRED_MESSAGE = "Your session expired. Sign in again."
export async function supportFetch(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, { ...init, cache: "no-store" })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const fallback = `The support service could not load this request (HTTP ${response.status}). Please try again.`
    const error = z
      .object({ detail: z.string().optional(), error: z.string().optional() })
      .safeParse(data)
    throw new SupportFetchError(
      error.success ? error.data.detail || error.data.error || fallback : fallback,
      response.status
    )
  }
  return data
}
