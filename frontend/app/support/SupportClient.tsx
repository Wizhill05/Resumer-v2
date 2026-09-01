"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { SUPPORT_CATEGORIES, type SupportCategoryValue } from "@/components/support/supportCategories"
import {
  Mic,
  Square,
  Trash2,
  Upload,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  Play,
  Pause,
  Loader2,
  X,
  Volume2,
} from "lucide-react"

interface SupportClientProps {
  userEmail?: string
  userName?: string
}

export function SupportClient({ userEmail }: SupportClientProps) {
  const [category, setCategory] = useState<SupportCategoryValue>("bug")
  const [message, setMessage] = useState("")
  const [emailOverride, setEmailOverride] = useState(userEmail || "")

  const [screenshots, setScreenshots] = useState<File[]>([])
  const [screenshotPreviews, setScreenshotPreviews] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null)
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    return () => {
      screenshotPreviews.forEach((url) => URL.revokeObjectURL(url))
      if (voiceUrl) URL.revokeObjectURL(voiceUrl)
    }
  }, [screenshotPreviews, voiceUrl])

  const handleScreenshotChange = (files: FileList | null) => {
    if (!files) return
    const newFiles = Array.from(files).filter((f) => f.type.startsWith("image/"))
    if (screenshots.length + newFiles.length > 5) {
      setError("Max 5 screenshots.")
      return
    }
    setError(null)
    setScreenshots([...screenshots, ...newFiles])
    setScreenshotPreviews([...screenshotPreviews, ...newFiles.map((f) => URL.createObjectURL(f))])
  }

  const removeScreenshot = (index: number) => {
    const removed = screenshotPreviews[index]
    if (removed) URL.revokeObjectURL(removed)
    setScreenshots(screenshots.filter((_, i) => i !== index))
    setScreenshotPreviews(screenshotPreviews.filter((_, i) => i !== index))
  }

  const startRecording = async () => {
    try {
      setError(null)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      let mimeType = "audio/webm"
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) mimeType = "audio/webm;codecs=opus"
      else if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) mimeType = "audio/ogg;codecs=opus"
      else if (MediaRecorder.isTypeSupported("audio/mp4")) mimeType = "audio/mp4"
      const mr = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mr
      audioChunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      mr.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mimeType })
        setVoiceBlob(blob)
        setVoiceUrl(URL.createObjectURL(blob))
        stream.getTracks().forEach((t) => t.stop())
      }
      mr.start(200)
      setIsRecording(true)
      setRecordingSeconds(0)
      timerRef.current = setInterval(() => setRecordingSeconds((p) => p + 1), 1000)
    } catch {
      setError("Microphone access denied.")
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }

  const discardVoice = () => {
    if (voiceUrl) URL.revokeObjectURL(voiceUrl)
    setVoiceBlob(null)
    setVoiceUrl(null)
    setIsPlaying(false)
  }

  const togglePlay = () => {
    if (!audioRef.current) return
    if (isPlaying) { audioRef.current.pause(); setIsPlaying(false) }
    else { audioRef.current.play(); setIsPlaying(true) }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim()) { setError("Add a short description."); return }
    setIsSubmitting(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append("message", message.trim())
      fd.append("category", category)
      if (emailOverride.trim()) fd.append("email_override", emailOverride.trim())
      screenshots.forEach((f) => fd.append("screenshots", f))
      if (voiceBlob) {
        const ext = voiceBlob.type.includes("webm") ? "webm" : voiceBlob.type.includes("mp4") ? "mp4" : "wav"
        fd.append("voice", voiceBlob, `recording.${ext}`)
      }
      const res = await fetch("/api/backend/feedback/support", { method: "POST", body: fd })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.detail || "Failed to send.")
      }
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
    } finally { setIsSubmitting(false) }
  }

  if (submitted) {
    return (
      <div className="border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6 text-center space-y-4">
        <div className="mx-auto flex h-11 w-11 items-center justify-center border border-zinc-200 dark:border-zinc-700 bg-[#ff4e26]/10 text-[#ff4e26]">
          <CheckCircle2 size={24} />
        </div>
        <div className="space-y-1">
          <h2 className="text-sm font-black uppercase tracking-tight">Report sent</h2>
          <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
            Thanks — it is in the queue. We will email you when it is resolved if you left an address.
          </p>
        </div>
        <div className="flex justify-center gap-2">
          <Button size="sm" onClick={() => { setSubmitted(false); setMessage(""); setScreenshots([]); setScreenshotPreviews([]); discardVoice() }}>
            Send another
          </Button>
          <Button variant="outline" size="sm" onClick={() => (window.location.href = "/dashboard")}>Dashboard</Button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 sm:p-6 space-y-5">
      <div className="space-y-2.5">
        <Label className="text-[11px] font-black uppercase tracking-widest text-zinc-500">Category</Label>
        <div className="flex flex-wrap gap-2">
          {SUPPORT_CATEGORIES.map((cat) => {
            const Icon = cat.icon
            const active = category === cat.value
            return (
              <button
                key={cat.value}
                type="button"
                onClick={() => setCategory(cat.value)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold leading-none transition-colors ${
                  active
                    ? "bg-[#ff4e26] text-white border-[#ff4e26] shadow-sm"
                    : "bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                <Icon size={13} className={active ? "text-white" : "text-zinc-400"} />
                {cat.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="message" className="text-[11px] font-black uppercase tracking-widest text-zinc-500">
          Message <span className="text-[#ff4e26]">*</span>
        </Label>
        <Textarea
          id="message"
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What happened? What did you expect?"
          className="min-h-[110px] text-sm md:min-h-[128px]"
          required
        />
      </div>

      <div className="grid gap-4 md:grid-cols-[1.1fr_1.6fr] md:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-[11px] font-black uppercase tracking-widest text-zinc-500">
            Email <span className="font-medium normal-case tracking-normal">optional</span>
          </Label>
          <Input
            id="email"
            type="email"
            value={emailOverride}
            onChange={(e) => setEmailOverride(e.target.value)}
            placeholder="you@example.com"
            className="h-9 font-mono text-sm"
          />
        </div>
        <p className="hidden md:block text-xs leading-relaxed text-zinc-500 dark:text-zinc-400 pb-1">
          Only for a follow-up. Leave blank to stay anonymous.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 border-t border-zinc-200 dark:border-zinc-800 pt-4">
        <div className="space-y-2.5">
          <div className="flex items-center gap-1.5">
            <Label className="text-[11px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
              <Volume2 size={12} className="text-[#ff4e26]" /> Voice
            </Label>
            <span className="text-[10px] font-medium text-zinc-400">optional</span>
            {voiceBlob && <span className="ml-auto text-[10px] font-mono font-bold text-emerald-600">Attached</span>}
          </div>

          {!voiceBlob && !isRecording && (
            <button
              type="button"
              onClick={startRecording}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-3 py-3 text-xs font-bold hover:border-zinc-400 dark:hover:border-zinc-600 hover:bg-white dark:hover:bg-zinc-800 transition-colors md:w-auto md:justify-start"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#ff4e26]/10 text-[#ff4e26]">
                <Mic size={12} />
              </span>
              Record voice
            </button>
          )}
          {isRecording && (
            <div className="flex items-center justify-between rounded-lg border border-[#ff4e26] bg-[#ff4e26]/10 px-3 py-2.5">
              <span className="flex items-center gap-2 text-xs font-mono font-bold text-[#ff4e26]">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#ff4e26]" />
                {Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, "0")}
              </span>
              <Button type="button" size="xs" onClick={stopRecording} className="bg-[#ff4e26] hover:bg-[#e03d16] text-white h-6 px-2.5 text-[11px]">
                <Square size={9} className="fill-white" /> Stop
              </Button>
            </div>
          )}
          {voiceUrl && !isRecording && (
            <div className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2.5 py-2">
              <audio ref={audioRef} src={voiceUrl} onEnded={() => setIsPlaying(false)} className="hidden" />
              <button type="button" onClick={togglePlay} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
                {isPlaying ? <Pause size={12} /> : <Play size={12} className="ml-0.5" />}
              </button>
              <span className="flex-1 truncate text-xs font-medium">Voice ready</span>
              <button type="button" onClick={discardVoice} className="rounded-full p-1.5 text-zinc-400 hover:bg-white dark:hover:bg-zinc-700 hover:text-red-500">
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center gap-1.5">
            <Label className="text-[11px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
              <ImageIcon size={12} className="text-[#ff4e26]" /> Screenshots
            </Label>
            <span className="text-[10px] font-mono text-zinc-500">{screenshots.length}/5</span>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleScreenshotChange(e.target.files)} />
          {screenshotPreviews.length > 0 && (
            <div className="grid grid-cols-5 gap-1.5">
              {screenshotPreviews.map((url, idx) => (
                <div key={idx} className="group relative aspect-square overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-100">
                  <img src={url} alt="" className="h-full w-full object-cover" />
                  <button type="button" onClick={() => removeScreenshot(idx)} className="absolute right-1 top-1 rounded-full bg-zinc-900/80 p-1 text-white opacity-0 group-hover:opacity-100 hover:bg-red-600 transition">
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {screenshots.length < 5 && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-3 py-3 text-xs font-bold hover:border-zinc-400 dark:hover:border-zinc-600 hover:bg-white dark:hover:bg-zinc-800 transition-colors md:w-auto md:justify-start"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900">
                <Upload size={11} />
              </span>
              Add images
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle size={14} className="shrink-0" /> <span>{error}</span>
        </div>
      )}

      <div className="flex flex-col-reverse gap-3 border-t border-zinc-200 dark:border-zinc-800 pt-4 md:flex-row md:items-center md:justify-between">
        <p className="text-center text-[11px] text-zinc-500 md:text-left">
          See <a href="/privacy" className="underline decoration-zinc-300 underline-offset-2 font-bold hover:text-zinc-900 dark:hover:text-white">Privacy</a> for storage.
        </p>
        <Button type="submit" disabled={isSubmitting} className="h-9 px-6 text-xs md:w-auto w-full">
          {isSubmitting ? <><Loader2 size={14} className="animate-spin" /> Sending...</> : "Send report"}
        </Button>
      </div>
    </form>
  )
}
