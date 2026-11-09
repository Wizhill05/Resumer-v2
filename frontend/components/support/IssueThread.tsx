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
import { AdminIssueEditor } from "./AdminIssueEditor"
import {
  issueHref,
  issueTitle,
  markLastSeen,
  rememberGuestIssue,
  savedGuestIssues,
  statusLabels,
  supportFetch,
  threadSchema,
  type SupportThread
} from "./supportApi"

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(normalized)
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

const pushStatusSchema = z.object({ subscribed: z.boolean() })
const publicKeySchema = z.object({ key: z.string() })

function PushToggle({ id, token }: { id: string; token?: string }) {
  const [available, setAvailable] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const pushUrl = useCallback(
    (endpoint?: string) => {
      const params = new URLSearchParams()
      if (token) params.set("access_token", token)
      if (endpoint) params.set("endpoint", endpoint)
      const qs = params.toString()
      return `/api/support/${encodeURIComponent(id)}/push${qs ? `?${qs}` : ""}`
    },
    [id, token]
  )

  useEffect(() => {
    let active = true
    async function init() {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return
      try {
        const res = await fetch("/api/support/push/public-key")
        if (!res.ok) return
        if (active) setAvailable(true)
        const reg = await navigator.serviceWorker.register("/support-sw.js")
        // The browser subscription is shared by every issue. Ask the server whether
        // this particular issue is subscribed with it.
        const sub = await reg.pushManager.getSubscription()
        if (!sub) {
          if (active) setSubscribed(false)
          return
        }
        const status = pushStatusSchema.parse(await supportFetch(pushUrl(sub.endpoint)))
        if (active) setSubscribed(status.subscribed)
      } catch {}
    }
    void init()
    return () => {
      active = false
    }
  }, [pushUrl])

  async function turnOn(reg: ServiceWorkerRegistration) {
    let sub = await reg.pushManager.getSubscription()
    let created = false
    if (!sub) {
      const permission =
        Notification.permission === "granted" ? "granted" : await Notification.requestPermission()
      if (permission !== "granted") {
        setMessage("Notifications are blocked in this browser. Allow them in site settings to turn this on.")
        return
      }
      const data = publicKeySchema.parse(await supportFetch("/api/support/push/public-key"))
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.key) as BufferSource
      })
      created = true
    }
    try {
      await supportFetch(pushUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON())
      })
    } catch (err) {
      // Only undo a subscription this click created; an older one may serve other issues.
      if (created) await sub.unsubscribe().catch(() => false)
      throw err
    }
    setSubscribed(true)
  }

  async function turnOff(reg: ServiceWorkerRegistration) {
    const sub = await reg.pushManager.getSubscription()
    // Never unsubscribe the browser here: other issues may still use the same subscription.
    if (sub) await supportFetch(pushUrl(sub.endpoint), { method: "DELETE" })
    setSubscribed(false)
  }

  async function toggle() {
    setBusy(true)
    setMessage(null)
    try {
      const reg = await navigator.serviceWorker.register("/support-sw.js")
      if (subscribed) await turnOff(reg)
      else await turnOn(reg)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not update notifications in this browser.")
    } finally {
      setBusy(false)
    }
  }

  if (!available) return null
  return (
    <div className="soft-card space-y-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold">Notify me in this browser when the team replies</p>
          <p className="text-xs leading-5 text-ink-muted">
            {subscribed ? "On. You will get a browser notification for replies on this issue." : "Off. Replies stay in this conversation."} On iPhone, add this site to your Home Screen first so notifications can work.
          </p>
        </div>
        <Button variant="outline" disabled={busy} onClick={() => void toggle()} className="min-h-11">
          {busy ? "Working..." : subscribed ? "Turn off" : "Turn on"}
        </Button>
      </div>
      {message && <p className="text-xs leading-5 text-ink-muted">{message}</p>}
    </div>
  )
}

function PrivateLinkCard({ id, token }: { id: string; token?: string }) {
  const [dismissed, setDismissed] = useState(false)
  const [copied, setCopied] = useState(false)
  const link = typeof window !== "undefined" ? `${window.location.origin}${issueHref(id, token)}` : issueHref(id, token)
  const code = id.slice(0, 8).toUpperCase()
  if (dismissed) return null
  return (
    <div className="soft-card space-y-3 p-5" role="status">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-bold">Your private ticket link</h2>
        <button type="button" className="min-h-11 min-w-11 text-sm font-bold underline" onClick={() => setDismissed(true)} aria-label="Dismiss private link card">
          Dismiss
        </button>
      </div>
      <p className="text-sm leading-6 text-ink-muted">
        Save this link. It is the only way to get back to this conversation on another device.
      </p>
      <p className="break-all text-sm">
        <span className="font-bold">Ticket code: </span>
        {code}
      </p>
      <p className="break-all rounded-md border border-line bg-paper p-3 text-xs">{link}</p>
      <Button
        className="min-h-11"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link)
            setCopied(true)
          } catch {
            setCopied(false)
          }
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </Button>
    </div>
  )
}

const replySchema = z.object({
  notification_status: z.enum(["sent", "failed", "not_configured", "no_recipient"]).optional()
})
export function IssueThread({
  id,
  accessToken,
  adminView = false,
  isNew = false
}: {
  id: string
  accessToken?: string
  adminView?: boolean
  isNew?: boolean
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
    if (result.last_admin_reply_at) markLastSeen(id, result.last_admin_reply_at)
    else markLastSeen(id, new Date().toISOString())
    return result
  }, [endpoint, query, id])
  useEffect(() => {
    let active = true
    void supportFetch(`${endpoint}${query}`)
      .then((result) => {
        if (active) {
          const parsed = threadSchema.parse(result)
          setThread(parsed)
          if (parsed.last_admin_reply_at) markLastSeen(id, parsed.last_admin_reply_at)
          else markLastSeen(id, new Date().toISOString())
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
  }, [endpoint, query, load, id])
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
        <p className="flex items-center gap-2 py-8 text-sm text-ink-muted">
          <Loader2 className="animate-spin" size={18} /> Loading conversation...
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300 rounded-md"
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
          <header className="space-y-3 border-b border-line pb-5">
            <h1 className="break-words text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
              {issueTitle(thread)}
            </h1>
            <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
              <span
                className={`inline-flex items-center gap-1.5 border px-2.5 py-1.5 font-bold rounded-md ${open ? "border-[#ff4e26] text-[#ff4e26]" : "border-line-strong text-ink-muted"}`}
              >
                {open ? <CircleDot size={15} /> : <CircleCheck size={15} />}
                {statusLabels[thread.status]}
              </span>
              <span>{getCategoryLabel(thread.category)}</span>
              <span>Opened {new Date(thread.created_at).toLocaleDateString()}</span>
            </div>
          </header>
          {thread.viewer_is_admin && (
            <AdminIssueEditor
              key={`${thread.id}-${thread.title}-${thread.category}`}
              issue={thread}
              onSaved={async () => {
                await load()
                setNotice("Issue details saved.")
              }}
            />
          )}
          {token && !thread.viewer_is_admin && (
            <p className="border-l border-[#ff4e26] pl-3 text-xs leading-5 text-ink-muted">
              This is your private issue link. Bookmark it to return to this conversation, and keep
              it to yourself.
            </p>
          )}
          {isNew && token && !thread.viewer_is_admin && (
            <PrivateLinkCard id={thread.id} token={token} />
          )}
          {!thread.viewer_is_admin && !adminView && (
            <PushToggle id={thread.id} token={token} />
          )}
          <section aria-label="Conversation" className="space-y-4">
            <article className="min-w-0 border border-line bg-paper rounded-md">
              <div className="flex flex-wrap items-center justify-between gap-1 border-b border-line bg-ink/[0.03] px-4 py-3 text-xs">
                <span className="font-bold">
                  {thread.viewer_is_admin
                    ? thread.user_name || thread.user_email || thread.email_override || "Guest"
                    : "You"}{" "}
                  <span className="font-normal text-ink-muted">opened this issue</span>
                </span>
                <time className="text-ink-muted" dateTime={thread.created_at}>
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
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-ink-muted">
                        {item.value}
                      </p>
                    </div>
                  ))}
                {thread.generation_id && (
                  <p className="break-all text-xs text-ink-muted">
                    Generation: {thread.generation_id}
                  </p>
                )}
                {thread.attachments.length > 0 && (
                  <div className="space-y-3 border-t border-line pt-4">
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
                                className="mb-2 h-auto max-h-96 w-auto max-w-full border border-line object-contain rounded-md"
                              />
                              {attachment.filename}
                            </a>
                          )}
                        </div>
                      ) : (
                        <p key={attachment.id} className="text-sm text-ink-muted">
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
                  className="flex items-start gap-2 border-l border-line py-2 pl-4 text-xs leading-5 text-ink-muted"
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
                  className={`min-w-0 border bg-paper rounded-md ${message.author_role === "admin" ? "border-[#ff4e26]/50" : "border-line"}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-1 border-b border-line bg-ink/[0.03] px-4 py-3 text-xs">
                    <span className="font-bold">
                      {message.author_role === "admin"
                        ? "Support team"
                        : thread.viewer_is_admin
                          ? thread.user_name || "Reporter"
                          : "You"}
                    </span>
                    <time dateTime={message.created_at} className="text-ink-muted">
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
            className="space-y-3 border border-line bg-paper p-4 sm:p-5 rounded-md"
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
              <p className="text-xs leading-5 text-ink-muted">Replying will reopen this issue.</p>
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
          <div className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-ink-muted">
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
            <p role="status" className="border-l border-[#ff4e26] pl-3 text-sm leading-6">
              {notice}
            </p>
          )}
        </>
      )}
    </div>
  )
}
