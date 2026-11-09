"use client"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2, Paperclip, X, Mic, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  SUPPORT_CATEGORIES,
  type SupportCategoryValue
} from "@/components/support/supportCategories"
import {
  createdIssueSchema,
  issueHref,
  rememberGuestIssue,
  supportFetch
} from "@/components/support/supportApi"

export function SupportClient({
  userEmail,
  signedIn = false,
  initialCategory,
  initialMessage = "",
  generationId,
  initialLocation = ""
}: {
  userEmail?: string
  signedIn?: boolean
  initialCategory?: string
  initialMessage?: string
  generationId?: string
  initialLocation?: string
}) {
  const router = useRouter()
  const [category, setCategory] = useState<SupportCategoryValue>(
    SUPPORT_CATEGORIES.find((item) => item.value === initialCategory)?.value ?? "bug"
  )
  const [title, setTitle] = useState("")
  const [message, setMessage] = useState(initialMessage)
  const [email, setEmail] = useState(userEmail || "")
  const [location, setLocation] = useState(initialLocation)
  const [steps, setSteps] = useState("")
  const [expected, setExpected] = useState("")
  const [screenshots, setScreenshots] = useState<File[]>([])
  const [voice, setVoice] = useState<{ blob: Blob; url: string } | null>(null)
  const [recording, setRecording] = useState(false)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const mounted = useRef(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState("")
  const turnstileHostRef = useRef<HTMLDivElement | null>(null)
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ""
  useEffect(() => {
    if (signedIn || !siteKey) return
    let cancelled = false
    const host = turnstileHostRef.current
    if (!host) return
    function renderWidget() {
      const w = window as unknown as { turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => string; reset: (id: string) => void } }
      if (cancelled || !w.turnstile) return
      w.turnstile.render(host!, {
        sitekey: siteKey,
        callback: (token: string) => setTurnstileToken(token),
        "expired-callback": () => setTurnstileToken(""),
        "error-callback": () => setTurnstileToken("")
      })
    }
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://challenges.cloudflare.com/turnstile/v0/api.js"]'
    )
    if (existing) {
      existing.addEventListener("load", renderWidget)
      renderWidget()
    } else {
      const script = document.createElement("script")
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js"
      script.async = true
      script.defer = true
      script.addEventListener("load", renderWidget)
      document.head.appendChild(script)
    }
    return () => {
      cancelled = true
    }
  }, [signedIn, siteKey])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (recorder.current?.state === "recording") recorder.current.stop()
      stream.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])
  useEffect(() => {
    return () => {
      if (voice) URL.revokeObjectURL(voice.url)
    }
  }, [voice])
  async function record() {
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")
        throw new Error(
          "Voice recording isn't available in this browser. You can still describe the issue below."
        )
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!mounted.current) {
        microphone.getTracks().forEach((track) => track.stop())
        return
      }
      stream.current = microphone
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((type) =>
        MediaRecorder.isTypeSupported(type)
      )
      const next = new MediaRecorder(microphone, mime ? { mimeType: mime } : undefined)
      recorder.current = next
      const chunks: BlobPart[] = []
      next.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data)
      }
      next.onstop = () => {
        microphone.getTracks().forEach((track) => track.stop())
        if (mounted.current) {
          const blob = new Blob(chunks, { type: next.mimeType })
          setVoice({ blob, url: URL.createObjectURL(blob) })
          setRecording(false)
        }
      }
      next.start()
      setRecording(true)
      setError(null)
    } catch (err) {
      stream.current?.getTracks().forEach((track) => track.stop())
      setError(
        err instanceof Error
          ? err.message
          : "Could not access the microphone. Check your browser permissions."
      )
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!message.trim()) {
      setError("Describe your issue before sending.")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const data = new FormData()
      data.set("title", title.trim())
      data.set("message", message.trim())
      data.set("category", category)
      if (email.trim()) data.set("email_override", email.trim())
      if (turnstileToken) data.set("turnstile_token", turnstileToken)
      if (generationId) data.set("generation_id", generationId)
      if (category !== "feedback") {
        data.set("where_happened", location.trim())
        data.set("steps_to_reproduce", steps.trim())
        data.set("expected_behavior", expected.trim())
      }
      screenshots.forEach((file) => data.append("screenshots", file))
      if (voice)
        data.set(
          "voice",
          voice.blob,
          `voice-note.${voice.blob.type.includes("mp4") ? "mp4" : voice.blob.type.includes("ogg") ? "ogg" : "webm"}`
        )
      const issue = createdIssueSchema.parse(
        await supportFetch("/api/support", { method: "POST", body: data })
      )
      if (issue.access_token && !signedIn) rememberGuestIssue(issue.id, issue.access_token)
      router.push(`${issueHref(issue.id, signedIn ? undefined : issue.access_token)}${issue.access_token ? "&new=1" : ""}`)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not create your issue. Your draft is still here."
      )
      setSubmitting(false)
    }
  }
  return (
    <div className="space-y-5">
      <form
        onSubmit={submit}
        className="soft-card space-y-6 p-5 sm:p-7"
      >
        <fieldset>
          <legend className="mb-2 text-sm font-bold">What can we help with?</legend>
          <div className="flex flex-wrap gap-2">
            {SUPPORT_CATEGORIES.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={category === item.value}
                onClick={() => setCategory(item.value)}
                className={`min-h-10 cursor-pointer border px-3.5 text-sm font-semibold rounded-md transition-colors ${category === item.value ? "border-ember/60 bg-ember-tint text-ember" : "border-line-strong bg-paper text-ink hover:border-ink/30"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="space-y-2">
          <Label htmlFor="issue-title">
            Title <span className="font-normal text-ink-muted">optional</span>
          </Label>
          <Input
            id="issue-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            placeholder={
              category === "feedback"
                ? "A short name for your idea"
                : "A short summary of the problem"
            }
            className="min-h-11 text-base sm:text-sm"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="issue-message">
            {category === "feedback" ? "What's your idea?" : "What happened?"}
          </Label>
          <Textarea
            id="issue-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            required
            maxLength={10000}
            rows={5}
            placeholder={
              category === "feedback"
                ? "What would you like to do, and how would it help?"
                : "Describe the problem in your own words."
            }
            className="min-h-36 text-base leading-6 sm:text-sm"
          />
        </div>
        {category !== "feedback" && (
          <details className="border-y border-line py-3">
            <summary className="cursor-pointer py-2 text-sm font-bold">
              Add details to help us investigate{" "}
              <span className="font-normal text-ink-muted">optional</span>
            </summary>
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="issue-location">Where did it happen?</Label>
                <Input
                  id="issue-location"
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  maxLength={2000}
                  placeholder="For example, the editor on my phone"
                  className="min-h-11 text-base sm:text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="issue-steps">How can we reproduce it?</Label>
                <Textarea
                  id="issue-steps"
                  value={steps}
                  onChange={(event) => setSteps(event.target.value)}
                  maxLength={10000}
                  placeholder="What were you doing just before the problem?"
                  rows={3}
                  className="text-base sm:text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="issue-expected">What did you expect to happen?</Label>
                <Textarea
                  id="issue-expected"
                  value={expected}
                  onChange={(event) => setExpected(event.target.value)}
                  maxLength={5000}
                  rows={2}
                  className="text-base sm:text-sm"
                />
              </div>
            </div>
          </details>
        )}
        <div className="space-y-3">
          <p className="text-sm font-bold">
            Attachments <span className="font-normal text-ink-muted">optional</span>
          </p>
          <div className="flex flex-wrap gap-3">
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 border border-line px-3 text-sm font-bold focus-within:outline-2 focus-within:outline-[#ff4e26] rounded-md">
              <Paperclip size={16} /> Add screenshots
              <input
                aria-label="Add screenshots"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                className="sr-only"
                onChange={(event) => {
                  const files = Array.from(event.target.files || [])
                  event.target.value = ""
                  if (
                    screenshots.length + files.length > 5 ||
                    files.some((file) => file.size > 5 * 1024 * 1024)
                  ) {
                    setError("Add up to 5 screenshots, no larger than 5 MB each.")
                    return
                  }
                  setScreenshots((current) => [...current, ...files])
                  setError(null)
                }}
              />
            </label>
            {!voice && (
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => (recording ? recorder.current?.stop() : void record())}
              >
                {recording ? <Square size={14} /> : <Mic size={14} />}
                {recording ? "Stop recording" : "Record voice note"}
              </Button>
            )}
          </div>
          <p className="text-xs text-ink-muted">
            Up to 5 images, 5 MB each. Avoid including passwords or private documents.
          </p>
          {screenshots.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              className="flex min-w-0 items-center justify-between gap-2 border-b border-line py-1"
            >
              <span className="truncate text-sm">{file.name}</span>
              <button
                type="button"
                className="flex min-h-11 min-w-11 items-center justify-center"
                aria-label={`Remove ${file.name}`}
                onClick={() =>
                  setScreenshots((current) => current.filter((_, position) => index !== position))
                }
              >
                <X size={16} />
              </button>
            </div>
          ))}
          {voice && (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <audio controls src={voice.url} className="max-w-full" />
              <button
                type="button"
                className="min-h-11 px-2 text-sm font-bold underline"
                onClick={() => {
                  setVoice(null)
                }}
              >
                Remove voice note
              </button>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="issue-email">
            Email for updates <span className="font-normal text-ink-muted">optional</span>
          </Label>
          <Input
            id="issue-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={254}
            placeholder="you@example.com"
            className="min-h-11 text-base sm:text-sm"
          />
          <p className="text-xs leading-5 text-ink-muted">
            Replies stay in this conversation. Email is optional and we will not send an automatic email to a guest address you type here.
            {!signedIn && " Keep your private issue link so you can return later."}
          </p>
          {!signedIn && siteKey && <div ref={turnstileHostRef} className="pt-1" aria-label="Human check" />}
        </div>
        {generationId && (
          <p className="break-all text-xs text-ink-muted">
            Generation context attached: {generationId}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300 rounded-md"
          >
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-muted">
            Only you and the support team can view this issue.
          </p>
          <Button type="submit" disabled={submitting || recording} className="min-h-11 px-5">
            {submitting && <Loader2 size={16} className="animate-spin" />}
            {submitting ? "Creating issue..." : "Create issue"}
          </Button>
        </div>
      </form>
    </div>
  )
}
