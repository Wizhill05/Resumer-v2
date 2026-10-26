import { z } from "zod"

export const issueSchema = z.object({
  id: z.string(),
  title: z.string().nullable().optional(),
  message: z.string(),
  category: z.string().nullable(),
  status: z.enum(["open", "in_progress", "resolved", "closed"]),
  created_at: z.string(),
  updated_at: z.string().nullable().optional()
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
export function savedGuestIssues() {
  try {
    return savedIssuesSchema.parse(
      JSON.parse(localStorage.getItem("resumer_support_threads") || "[]")
    )
  } catch {
    return []
  }
}
export function rememberGuestIssue(id: string, token: string) {
  try {
    localStorage.setItem(
      "resumer_support_threads",
      JSON.stringify(
        [{ id, token }, ...savedGuestIssues().filter((issue) => issue.id !== id)].slice(0, 30)
      )
    )
  } catch {}
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
export async function supportFetch(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, { ...init, cache: "no-store" })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const fallback = `The support service could not load this request (HTTP ${response.status}). Please try again.`
    const error = z
      .object({ detail: z.string().optional(), error: z.string().optional() })
      .safeParse(data)
    throw new Error(error.success ? error.data.detail || error.data.error || fallback : fallback)
  }
  return data
}
