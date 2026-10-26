"use client"
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { ArrowLeft, CircleCheck, CircleDot, Loader2, RefreshCw, Send } from "lucide-react"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { getCategoryLabel } from "./supportCategories"
import {
  issueTitle,
  rememberGuestIssue,
  savedGuestIssues,
  statusLabels,
  supportFetch,
  threadSchema,
  type SupportThread
} from "./supportApi"

const replySchema = z.object({
  notification_status: z.enum(["sent", "failed", "not_configured", "no_recipient"]).optional()
})
export function IssueThread({
  id,
  accessToken,
  adminView = false
}: {
  id: string
  accessToken?: string
  adminView?: boolean
}) {
  const [thread, setThread] = useState<SupportThread | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState<"reply" | "status" | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [token] = useState(
    () => accessToken || savedGuestIssues().find((issue) => issue.id === id)?.token
  )
  const endpoint = `/api/support/${encodeURIComponent(id)}`
  const query = token ? `?access_token=${encodeURIComponent(token)}` : ""
  useEffect(() => {
    if (accessToken) rememberGuestIssue(id, accessToken)
  }, [id, accessToken])
  const load = useCallback(async () => {
    const result = threadSchema.parse(await supportFetch(`${endpoint}${query}`))
    setThread(result)
    return result
  }, [endpoint, query])
  useEffect(() => {
    let active = true
    void supportFetch(`${endpoint}${query}`)
      .then((result) => {
        if (active) {
          setThread(threadSchema.parse(result))
          setError(null)
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Could not load this issue.")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void load().catch(() => {})
    }, 30000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [endpoint, query, load])
  async function reply(event: React.FormEvent) {
    event.preventDefault()
    if (!draft.trim()) return
    setBusy("reply")
    setError(null)
    setNotice(null)
    try {
      const response = replySchema.parse(
        await supportFetch(`${endpoint}/messages${query}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: draft.trim() })
        })
      )
      setDraft("")
      setNotice(
        response.notification_status === "sent"
          ? "Reply posted and email notification sent."
          : thread?.viewer_is_admin && response.notification_status === "failed"
            ? "Reply posted. The email notification failed, but the reply is available in this conversation."
            : thread?.viewer_is_admin && response.notification_status === "not_configured"
              ? "Reply posted. Email notifications aren't configured on the server."
              : thread?.viewer_is_admin && response.notification_status === "no_recipient"
                ? "Reply posted. No email address was provided; the user can read it here."
                : "Reply posted."
      )
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post your reply.")
    } finally {
      setBusy(null)
    }
  }
  async function changeStatus() {
    if (!thread) return
    setBusy("status")
    setError(null)
    setNotice(null)
    const open = thread.status === "open" || thread.status === "in_progress"
    try {
      const url = thread.viewer_is_admin
        ? `/api/backend/admin/feedback/reports/${encodeURIComponent(id)}`
        : `${endpoint}${query}`
      await supportFetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: open ? "closed" : "open" })
      })
      await load()
      setNotice(open ? "Issue closed. You can still reply or reopen it." : "Issue reopened.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the issue.")
    } finally {
      setBusy(null)
    }
  }
  const open = thread?.status === "open" || thread?.status === "in_progress"
  return (
    <div className="space-y-5">
      <Link
        href={thread?.viewer_is_admin || adminView ? "/admin?tab=feedback" : "/support"}
        className="inline-flex min-h-11 items-center gap-2 text-sm font-bold"
      >
        <ArrowLeft size={16} />{" "}
        {thread?.viewer_is_admin || adminView ? "Support inbox" : "All issues"}
      </Link>
      {loading && (
        <p className="flex items-center gap-2 py-8 text-sm text-zinc-500">
          <Loader2 className="animate-spin" size={18} /> Loading conversation...
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300"
        >
          <p>{error}</p>
          {!thread && (
            <p className="mt-2">
              {adminView
                ? "Return to the support inbox to open another issue, or try loading this conversation again."
                : "Try loading the conversation again. If you opened a guest issue, use its private link."}
            </p>
          )}
          <button
            className="mt-2 min-h-11 font-bold underline"
            onClick={() => {
              void load()
                .then(() => setError(null))
                .catch((err) =>
                  setError(err instanceof Error ? err.message : "Could not load this issue.")
                )
            }}
          >
            Try again
          </button>
        </div>
      )}
      {thread && (
        <>
          <header className="space-y-3 border-b border-zinc-300 pb-5 dark:border-zinc-700">
            <h1 className="break-words text-2xl font-black leading-tight tracking-tight sm:text-3xl">
              {issueTitle(thread)}
            </h1>
            <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
              <span
                className={`inline-flex items-center gap-1.5 border px-2.5 py-1.5 font-bold ${open ? "border-[#ff4e26] text-[#ff4e26]" : "border-zinc-400 text-zinc-600 dark:text-zinc-300"}`}
              >
                {open ? <CircleDot size={15} /> : <CircleCheck size={15} />}
                {statusLabels[thread.status]}
              </span>
              <span>{getCategoryLabel(thread.category)}</span>
              <span>Opened {new Date(thread.created_at).toLocaleDateString()}</span>
            </div>
          </header>
          {token && !thread.viewer_is_admin && (
            <p className="border-l-2 border-[#ff4e26] pl-3 text-xs leading-5 text-zinc-500">
              This is your private issue link. Bookmark it to return to this conversation, and keep
              it to yourself.
            </p>
          )}
          <section aria-label="Conversation" className="space-y-4">
            <article className="min-w-0 border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center justify-between gap-1 border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-xs dark:border-zinc-700 dark:bg-zinc-800/50">
                <span className="font-bold">
                  {thread.viewer_is_admin
                    ? thread.user_name || thread.user_email || thread.email_override || "Guest"
                    : "You"}{" "}
                  <span className="font-normal text-zinc-500">opened this issue</span>
                </span>
                <time className="text-zinc-500" dateTime={thread.created_at}>
                  {new Date(thread.created_at).toLocaleString()}
                </time>
              </div>
              <div className="space-y-5 p-4 sm:p-5">
                <p className="whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">
                  {thread.message}
                </p>
                {[
                  { label: "Where it happened", value: thread.where_happened },
                  { label: "Steps to reproduce", value: thread.steps_to_reproduce },
                  { label: "Expected behavior", value: thread.expected_behavior }
                ]
                  .filter((item) => item.value)
                  .map((item) => (
                    <div key={item.label}>
                      <h2 className="text-sm font-bold">{item.label}</h2>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                        {item.value}
                      </p>
                    </div>
                  ))}
                {thread.generation_id && (
                  <p className="break-all text-xs text-zinc-500">
                    Generation: {thread.generation_id}
                  </p>
                )}
                {thread.attachments.length > 0 && (
                  <div className="space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-700">
                    <h2 className="text-sm font-bold">Attachments</h2>
                    {thread.attachments.map((attachment) =>
                      attachment.presigned_url ? (
                        <div key={attachment.id} className="min-w-0">
                          {attachment.attachment_type === "voice_recording" ? (
                            <div className="space-y-2">
                              <audio
                                controls
                                src={attachment.presigned_url}
                                className="max-w-full"
                              />
                              {attachment.transcription && (
                                <p className="whitespace-pre-wrap break-words text-sm leading-6">
                                  {attachment.transcription}
                                </p>
                              )}
                            </div>
                          ) : (
                            <a
                              href={attachment.presigned_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              referrerPolicy="no-referrer"
                              className="inline-block max-w-full break-all text-sm font-bold text-[#ff4e26] underline"
                            >
                              <Image
                                src={attachment.presigned_url}
                                alt={attachment.filename}
                                width={800}
                                height={600}
                                unoptimized
                                className="mb-2 h-auto max-h-96 w-auto max-w-full border border-zinc-200 object-contain dark:border-zinc-700"
                              />
                              {attachment.filename}
                            </a>
                          )}
                        </div>
                      ) : (
                        <p key={attachment.id} className="text-sm text-zinc-500">
                          {attachment.filename} is temporarily unavailable.
                        </p>
                      )
                    )}
                  </div>
                )}
              </div>
            </article>
            {thread.messages.map((message) =>
              message.author_role === "system" ? (
                <p
                  key={message.id}
                  className="flex items-start gap-2 border-l-2 border-zinc-300 py-2 pl-4 text-xs leading-5 text-zinc-500 dark:border-zinc-700"
                >
                  <CircleDot size={14} className="mt-0.5 shrink-0" />
                  <span>
                    {message.message}{" "}
                    <time dateTime={message.created_at} className="ml-1">
                      {new Date(message.created_at).toLocaleString()}
                    </time>
                  </span>
                </p>
              ) : (
                <article
                  key={message.id}
                  className={`min-w-0 border bg-white dark:bg-zinc-900 ${message.author_role === "admin" ? "border-[#ff4e26]/50" : "border-zinc-300 dark:border-zinc-700"}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-1 border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-xs dark:border-zinc-700 dark:bg-zinc-800/50">
                    <span className="font-bold">
                      {message.author_role === "admin"
                        ? "Support team"
                        : thread.viewer_is_admin
                          ? thread.user_name || "Reporter"
                          : "You"}
                    </span>
                    <time dateTime={message.created_at} className="text-zinc-500">
                      {new Date(message.created_at).toLocaleString()}
                    </time>
                  </div>
                  <p className="whitespace-pre-wrap break-words p-4 text-sm leading-7 [overflow-wrap:anywhere] sm:p-5">
                    {message.message}
                  </p>
                </article>
              )
            )}
          </section>
          <form
            onSubmit={reply}
            className="space-y-3 border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900 sm:p-5"
          >
            <Label htmlFor="issue-reply" className="text-sm font-bold">
              Leave a reply
            </Label>
            <Textarea
              id="issue-reply"
              rows={5}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              required
              maxLength={10000}
              placeholder="Add an update, answer a question, or share more details..."
              className="text-base leading-6 sm:text-sm"
            />
            {!open && !thread.viewer_is_admin && (
              <p className="text-xs leading-5 text-zinc-500">Replying will reopen this issue.</p>
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              <Button type="submit" disabled={busy !== null || !draft.trim()} className="min-h-11">
                {busy === "reply" ? (
                  <Loader2 className="animate-spin" size={15} />
                ) : (
                  <Send size={15} />
                )}{" "}
                Post reply
              </Button>
            </div>
          </form>
          <div className="flex flex-col gap-3 border-t border-zinc-300 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-700">
            <p className="text-xs leading-5 text-zinc-500">
              {open
                ? "Finished with this conversation? You can close it and reopen it later."
                : "Need more help? Reopen the issue to continue."}
            </p>
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => void changeStatus()}
              className="min-h-11"
            >
              {busy === "status" ? (
                <Loader2 size={15} className="animate-spin" />
              ) : open ? (
                <CircleCheck size={15} />
              ) : (
                <RefreshCw size={15} />
              )}
              {open ? "Close issue" : "Reopen issue"}
            </Button>
          </div>
          {notice && (
            <p role="status" className="border-l-2 border-[#ff4e26] pl-3 text-sm leading-6">
              {notice}
            </p>
          )}
        </>
      )}
    </div>
  )
}
