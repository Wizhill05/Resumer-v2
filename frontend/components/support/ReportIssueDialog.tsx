"use client"

import { useState, useRef, useEffect } from "react"
import { createPortal } from "react-dom"
import { X, Mic, Square, Trash2, Upload, Image as ImageIcon, CheckCircle2, AlertCircle, Play, Pause, Loader2, Volume2, Bug } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { SUPPORT_CATEGORIES, type SupportCategoryValue } from "./supportCategories"

interface Props {
  open: boolean
  onClose: () => void
  defaultCategory?: SupportCategoryValue
  defaultMessage?: string
  generationId?: string
  userEmail?: string
  title?: string
  description?: string
}

export function ReportIssueDialog({
  open,
  onClose,
  defaultCategory = "bug",
  defaultMessage = "",
  generationId,
  userEmail,
  title = "Report an issue",
  description = "Add a short note — we handle the context.",
}: Props) {
  const [category, setCategory] = useState<SupportCategoryValue>(defaultCategory)
  const [message, setMessage] = useState(defaultMessage)
  const [emailOverride, setEmailOverride] = useState(userEmail || "")
  const [screenshots, setScreenshots] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null)
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null)
  const mrRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (open) {
      setCategory(defaultCategory)
      setMessage(defaultMessage)
      setEmailOverride(userEmail || "")
      setError(null)
      setSubmitted(false)
    }
  }, [open, defaultCategory, defaultMessage, userEmail])

  useEffect(() => { if (open) setMessage(defaultMessage) }, [defaultMessage, open])
  useEffect(() => { if (open) setCategory(defaultCategory) }, [defaultCategory, open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !isRecording) onClose() }
    window.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev }
  }, [open, onClose, isRecording])

  useEffect(() => () => {
    previews.forEach((u) => URL.revokeObjectURL(u))
    if (voiceUrl) URL.revokeObjectURL(voiceUrl)
  }, [previews, voiceUrl])

  const onFiles = (files: FileList | null) => {
    if (!files) return
    const next = Array.from(files).filter((f) => f.type.startsWith("image/"))
    if (screenshots.length + next.length > 5) { setError("Max 5 images."); return }
    setError(null)
    setScreenshots([...screenshots, ...next])
    setPreviews([...previews, ...next.map((f) => URL.createObjectURL(f))])
  }
  const removeAt = (i: number) => {
    const u = previews[i]; if (u) URL.revokeObjectURL(u)
    setScreenshots(screenshots.filter((_, idx) => idx !== i))
    setPreviews(previews.filter((_, idx) => idx !== i))
  }

  const startRec = async () => {
    try {
      setError(null)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      let mime = "audio/webm"
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) mime = "audio/webm;codecs=opus"
      else if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) mime = "audio/ogg;codecs=opus"
      else if (MediaRecorder.isTypeSupported("audio/mp4")) mime = "audio/mp4"
      const mr = new MediaRecorder(stream, { mimeType: mime })
      mrRef.current = mr
      chunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime })
        setVoiceBlob(blob); setVoiceUrl(URL.createObjectURL(blob))
        stream.getTracks().forEach((t) => t.stop())
      }
      mr.start(200); setIsRecording(true); setSeconds(0)
      timerRef.current = setInterval(() => setSeconds((p) => p + 1), 1000)
    } catch { setError("Microphone blocked.") }
  }
  const stopRec = () => { if (mrRef.current && isRecording) { mrRef.current.stop(); setIsRecording(false); if (timerRef.current) clearInterval(timerRef.current) } }
  const discardVoice = () => { if (voiceUrl) URL.revokeObjectURL(voiceUrl); setVoiceBlob(null); setVoiceUrl(null); setIsPlaying(false) }
  const togglePlay = () => {
    if (!audioRef.current) return
    if (isPlaying) { audioRef.current.pause(); setIsPlaying(false) } else { audioRef.current.play(); setIsPlaying(true) }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim()) { setError("Add a short description."); return }
    setSubmitting(true); setError(null)
    try {
      const fd = new FormData()
      fd.append("message", message.trim())
      fd.append("category", category)
      if (emailOverride.trim()) fd.append("email_override", emailOverride.trim())
      if (generationId) fd.append("generation_id", generationId)
      screenshots.forEach((f) => fd.append("screenshots", f))
      if (voiceBlob) {
        const ext = voiceBlob.type.includes("webm") ? "webm" : voiceBlob.type.includes("mp4") ? "mp4" : "wav"
        fd.append("voice", voiceBlob, `recording.${ext}`)
      }
      const res = await fetch("/api/backend/feedback/support", { method: "POST", body: fd })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.detail || "Failed.") }
      setSubmitted(true)
    } catch (err) { setError(err instanceof Error ? err.message : "Error") } finally { setSubmitting(false) }
  }

  const close = () => {
    if (isRecording) return
    if (voiceUrl) URL.revokeObjectURL(voiceUrl)
    previews.forEach((u) => URL.revokeObjectURL(u))
    setScreenshots([]); setPreviews([]); setVoiceBlob(null); setVoiceUrl(null); setSubmitted(false); setError(null)
    onClose()
  }

  if (!open || typeof document === "undefined") return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-xs p-0 md:p-4" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="w-full max-w-lg max-h-[92dvh] md:max-h-[90vh] flex flex-col overflow-hidden bg-white dark:bg-zinc-900 border-t md:border border-zinc-200 dark:border-zinc-700 md:shadow-lg">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex h-7 w-7 items-center justify-center bg-[#ff4e26] text-white"><Bug size={14} /></span>
            <h2 className="text-sm font-black uppercase tracking-tight truncate">{title}</h2>
          </div>
          <button onClick={close} className="p-1.5 text-zinc-500 hover:text-black dark:hover:text-white border border-zinc-200 dark:border-zinc-700"><X size={14} /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {submitted ? (
            <div className="p-6 text-center space-y-3">
              <div className="mx-auto flex h-10 w-10 items-center justify-center bg-[#ff4e26]/10 text-[#ff4e26] border border-[#ff4e26]/20"><CheckCircle2 size={22} /></div>
              <h3 className="text-sm font-black uppercase">Report sent</h3>
              <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">Thanks — it is in the queue. We will email you if you left an address.</p>
              <div className="flex justify-center gap-2 pt-1">
                <Button size="sm" onClick={close}>Close</Button>
                <Button variant="outline" size="sm" onClick={() => { setSubmitted(false); setMessage(defaultMessage); setScreenshots([]); setPreviews([]); discardVoice() }}>Send another</Button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="p-4 sm:p-5 space-y-4">
              <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{description}</p>

              <div className="space-y-2">
                <Label className="text-[11px] font-black uppercase tracking-widest text-zinc-500">Category</Label>
                <div className="flex flex-wrap gap-1.5">
                  {SUPPORT_CATEGORIES.map((cat) => {
                    const Icon = cat.icon
                    const active = category === cat.value
                    return (
                      <button key={cat.value} type="button" onClick={() => setCategory(cat.value)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold leading-none transition-colors ${active ? "bg-[#ff4e26] text-white border-[#ff4e26]" : "bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300"}`}>
                        <Icon size={12} className={active ? "text-white" : "text-zinc-400"} /> {cat.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[11px] font-black uppercase tracking-widest text-zinc-500">Message <span className="text-[#ff4e26]">*</span></Label>
                <Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What happened? What did you expect?" className="text-sm min-h-[96px]" required />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[11px] font-black uppercase tracking-widest text-zinc-500">Email <span className="font-medium normal-case">optional</span></Label>
                <Input type="email" value={emailOverride} onChange={(e) => setEmailOverride(e.target.value)} placeholder="you@example.com" className="h-9 font-mono text-sm" />
              </div>

              <div className="grid gap-4 sm:grid-cols-2 border-t border-zinc-200 dark:border-zinc-800 pt-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-1"><Volume2 size={11} className="text-[#ff4e26]" /> Voice</span>
                    {voiceBlob && <span className="ml-auto text-[10px] font-mono font-bold text-emerald-600">Attached</span>}
                  </div>
                  {!voiceBlob && !isRecording && (
                    <button type="button" onClick={startRec} className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2.5 text-xs font-bold hover:bg-white dark:hover:bg-zinc-800 transition-colors w-full sm:w-auto">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#ff4e26]/10 text-[#ff4e26]"><Mic size={11} /></span> Record
                    </button>
                  )}
                  {isRecording && (
                    <div className="flex items-center justify-between rounded-lg border border-[#ff4e26] bg-[#ff4e26]/10 px-3 py-2">
                      <span className="text-xs font-mono font-bold text-[#ff4e26] flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-[#ff4e26]" />{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>
                      <Button type="button" size="xs" onClick={stopRec} className="bg-[#ff4e26] text-white h-6 px-2.5 text-[11px]"><Square size={9} className="fill-white" /> Stop</Button>
                    </div>
                  )}
                  {voiceUrl && !isRecording && (
                    <div className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2.5 py-2">
                      <audio ref={audioRef} src={voiceUrl} onEnded={() => setIsPlaying(false)} className="hidden" />
                      <button type="button" onClick={togglePlay} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"><span>{isPlaying ? <Pause size={11} /> : <Play size={11} className="ml-0.5" />}</span></button>
                      <span className="flex-1 truncate text-xs font-medium">Voice ready</span>
                      <button type="button" onClick={discardVoice} className="rounded-full p-1.5 text-zinc-400 hover:text-red-500"><Trash2 size={12} /></button>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-1"><ImageIcon size={11} className="text-[#ff4e26]" /> Images</span>
                    <span className="text-[10px] font-mono text-zinc-500 ml-auto">{screenshots.length}/5</span>
                  </div>
                  <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
                  {previews.length > 0 && (
                    <div className="grid grid-cols-5 gap-1.5">
                      {previews.map((url, i) => (
                        <div key={i} className="group relative aspect-square overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-100">
                          <img src={url} alt="" className="h-full w-full object-cover" />
                          <button type="button" onClick={() => removeAt(i)} className="absolute right-1 top-1 rounded-full bg-zinc-900/80 p-1 text-white opacity-0 group-hover:opacity-100"><X size={9} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                  {screenshots.length < 5 && (
                    <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2.5 text-xs font-bold hover:bg-white dark:hover:bg-zinc-800 transition-colors sm:w-auto">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900"><Upload size={11} /></span> Add images
                    </button>
                  )}
                </div>
              </div>

              {error && <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 dark:bg-red-950/40 dark:text-red-300"><AlertCircle size={13} className="shrink-0" />{error}</div>}

              <div className="flex gap-2 pt-1">
                <Button type="button" variant="outline" onClick={close} className="flex-1 sm:flex-none">Cancel</Button>
                <Button type="submit" disabled={submitting} className="flex-1 sm:flex-none sm:ml-auto px-6">{submitting ? <><Loader2 size={13} className="animate-spin" /> Sending...</> : "Send"}</Button>
              </div>
              {generationId && <p className="text-center text-[10px] font-mono text-zinc-400 sm:text-right">Linked to {generationId.slice(0, 8)}…</p>}
            </form>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

export function ReportIssueButton({
  defaultCategory,
  defaultMessage,
  generationId,
  userEmail,
  title,
  description,
  children,
  className,
  variant = "outline",
  size = "sm",
}: {
  defaultCategory?: SupportCategoryValue
  defaultMessage?: string
  generationId?: string
  userEmail?: string
  title?: string
  description?: string
  children?: React.ReactNode
  className?: string
  variant?: "default" | "outline" | "ghost"
  size?: "default" | "xs" | "sm" | "lg" | "icon" | "icon-sm"
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
        {children ?? <><Bug size={13} /> Report issue</>}
      </Button>
      <ReportIssueDialog open={open} onClose={() => setOpen(false)} defaultCategory={defaultCategory} defaultMessage={defaultMessage} generationId={generationId} userEmail={userEmail} title={title} description={description} />
    </>
  )
}
