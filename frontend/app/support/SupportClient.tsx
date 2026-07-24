"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
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

export function SupportClient({ userEmail, userName }: SupportClientProps) {
  const [category, setCategory] = useState<"bug" | "billing" | "feedback" | "other">("bug")
  const [message, setMessage] = useState("")
  const [emailOverride, setEmailOverride] = useState(userEmail || "")

  // Screenshots state
  const [screenshots, setScreenshots] = useState<File[]>([])
  const [screenshotPreviews, setScreenshotPreviews] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null)
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  // Audio player state
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Form submission state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  // Clean up object URLs
  useEffect(() => {
    return () => {
      screenshotPreviews.forEach((url) => URL.revokeObjectURL(url))
      if (voiceUrl) URL.revokeObjectURL(voiceUrl)
    }
  }, [screenshotPreviews, voiceUrl])

  // Handle Screenshot file pick
  const handleScreenshotChange = (files: FileList | null) => {
    if (!files) return
    const newFiles = Array.from(files).filter((f) => f.type.startsWith("image/"))
    if (screenshots.length + newFiles.length > 5) {
      setError("Maximum 5 screenshots allowed per report.")
      return
    }
    setError(null)
    const updatedScreenshots = [...screenshots, ...newFiles]
    setScreenshots(updatedScreenshots)

    const updatedPreviews = newFiles.map((f) => URL.createObjectURL(f))
    setScreenshotPreviews([...screenshotPreviews, ...updatedPreviews])
  }

  const removeScreenshot = (index: number) => {
    const updatedScreenshots = screenshots.filter((_, i) => i !== index)
    const removedPreview = screenshotPreviews[index]
    if (removedPreview) URL.revokeObjectURL(removedPreview)
    const updatedPreviews = screenshotPreviews.filter((_, i) => i !== index)

    setScreenshots(updatedScreenshots)
    setScreenshotPreviews(updatedPreviews)
  }

  // Voice recorder controls
  const startRecording = async () => {
    try {
      setError(null)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      let mimeType = "audio/webm"
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        mimeType = "audio/webm;codecs=opus"
      } else if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) {
        mimeType = "audio/ogg;codecs=opus"
      } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
        mimeType = "audio/mp4"
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data)
        }
      }

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType })
        const url = URL.createObjectURL(audioBlob)
        setVoiceBlob(audioBlob)
        setVoiceUrl(url)

        // Stop all audio tracks to release microphone
        stream.getTracks().forEach((track) => track.stop())
      }

      mediaRecorder.start(200)
      setIsRecording(true)
      setRecordingSeconds(0)

      timerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1)
      }, 1000)
    } catch (err) {
      console.error("Microphone access failed:", err)
      setError("Could not access microphone. Please check browser permissions.")
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

  const toggleAudioPlay = () => {
    if (!audioRef.current) return
    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)
    } else {
      audioRef.current.play()
      setIsPlaying(true)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim()) {
      setError("Please enter a message describing your issue or feedback.")
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append("message", message.trim())
      formData.append("category", category)

      if (emailOverride.trim()) {
        formData.append("email_override", emailOverride.trim())
      }

      screenshots.forEach((file) => {
        formData.append("screenshots", file)
      })

      if (voiceBlob) {
        const ext = voiceBlob.type.includes("webm") ? "webm" : "wav"
        formData.append("voice", voiceBlob, `recording.${ext}`)
      }

      const res = await fetch("/api/backend/feedback/support", {
        method: "POST",
        body: formData,
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.detail || "Failed to submit support report.")
      }

      setSubmitted(true)
    } catch (err: unknown) {
      const errorObj = err as Error
      setError(errorObj.message || "An unexpected error occurred.")
    } finally {
      setIsSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="panel-strong max-w-xl mx-auto p-8 text-center space-y-5 bg-white dark:bg-zinc-900 border-2 border-black dark:border-zinc-700 shadow-[4px_4px_0px_#000000]">
        <div className="mx-auto w-16 h-16 bg-[#ff4e26]/10 text-[#ff4e26] flex items-center justify-center border-2 border-black dark:border-zinc-700 shadow-[2px_2px_0px_#000000]">
          <CheckCircle2 size={36} />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-extrabold uppercase tracking-tight">Report Received</h2>
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
            Thank you! Your feedback has been routed directly to our admin team. If you left an email address, we will keep you updated.
          </p>
        </div>
        <Button
          onClick={() => {
            setSubmitted(false)
            setMessage("")
            setScreenshots([])
            setScreenshotPreviews([])
            discardVoice()
          }}
          className="bg-black hover:bg-zinc-800 text-white font-extrabold uppercase tracking-wider shadow-[3px_3px_0px_#ff4e26] border-2 border-black"
        >
          Submit Another Report
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="panel-strong max-w-2xl mx-auto p-5 sm:p-7 space-y-6 bg-white dark:bg-zinc-900 border-2 border-black dark:border-zinc-700 shadow-[4px_4px_0px_#000000]">
      {/* Category selector */}
      <div className="space-y-2">
        <Label className="text-xs font-extrabold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          Category
        </Label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(["bug", "billing", "feedback", "other"] as const).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`py-2 px-3 text-xs font-extrabold uppercase tracking-wider border-2 transition-all ${
                category === cat
                  ? "bg-[#ff4e26] text-white border-black shadow-[2px_2px_0px_#000000]"
                  : "bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-200"
              }`}
            >
              {cat === "bug" && "🐛 Bug Report"}
              {cat === "billing" && "💳 Billing"}
              {cat === "feedback" && "💡 Feedback"}
              {cat === "other" && "💬 Other"}
            </button>
          ))}
        </div>
      </div>

      {/* Message textarea */}
      <div className="space-y-2">
        <Label htmlFor="message" className="text-xs font-extrabold uppercase tracking-widest text-zinc-700 dark:text-zinc-300">
          Detailed Message <span className="text-[#ff4e26]">*</span>
        </Label>
        <Textarea
          id="message"
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Describe what happened, steps to reproduce the issue, or your feature request..."
          className="border-2 border-black dark:border-zinc-700 font-sans focus:ring-[#ff4e26] shadow-[2px_2px_0px_#000000]"
          required
        />
      </div>

      {/* Email input for notifications */}
      <div className="space-y-2">
        <Label htmlFor="email" className="text-xs font-extrabold uppercase tracking-widest text-zinc-700 dark:text-zinc-300">
          Your Email (for updates)
        </Label>
        <Input
          id="email"
          type="email"
          value={emailOverride}
          onChange={(e) => setEmailOverride(e.target.value)}
          placeholder="email@example.com"
          className="border-2 border-black dark:border-zinc-700 font-mono text-sm shadow-[2px_2px_0px_#000000]"
        />
      </div>

      {/* Voice Message Recorder Section */}
      <div className="space-y-3 pt-2 border-t border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-extrabold uppercase tracking-widest text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
            <Volume2 size={14} className="text-[#ff4e26]" />
            Voice Message (Optional)
          </Label>
          {voiceBlob && <Badge className="bg-emerald-500 text-white font-mono text-[10px]">Audio Attached</Badge>}
        </div>

        {!voiceBlob && !isRecording && (
          <Button
            type="button"
            variant="outline"
            onClick={startRecording}
            className="w-full border-2 border-black dark:border-zinc-700 border-dashed py-6 hover:bg-[#ff4e26]/5 hover:border-[#ff4e26] transition-colors"
          >
            <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-zinc-800 dark:text-zinc-200">
              <Mic size={18} className="text-[#ff4e26]" />
              <span>Record Voice Message</span>
            </div>
          </Button>
        )}

        {isRecording && (
          <div className="p-4 border-2 border-[#ff4e26] bg-[#ff4e26]/10 flex items-center justify-between shadow-[2px_2px_0px_#000000]">
            <div className="flex items-center gap-3">
              <span className="w-3 h-3 bg-[#ff4e26] rounded-full animate-ping" />
              <span className="font-mono font-bold text-sm text-[#ff4e26]">
                Recording: {Math.floor(recordingSeconds / 60)}:{(recordingSeconds % 60).toString().padStart(2, "0")}
              </span>
            </div>
            <Button
              type="button"
              onClick={stopRecording}
              size="sm"
              className="bg-[#ff4e26] hover:bg-[#e03d16] text-white font-extrabold uppercase tracking-wider"
            >
              <Square size={14} className="mr-1 fill-white" /> Stop
            </Button>
          </div>
        )}

        {voiceUrl && !isRecording && (
          <div className="p-3 border-2 border-black dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 flex items-center justify-between gap-3 shadow-[2px_2px_0px_#000000]">
            <audio
              ref={audioRef}
              src={voiceUrl}
              onEnded={() => setIsPlaying(false)}
              className="hidden"
            />
            <button
              type="button"
              onClick={toggleAudioPlay}
              className="w-9 h-9 bg-black text-white flex items-center justify-center border border-black hover:bg-zinc-800 shrink-0"
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider truncate">Voice Recording</p>
              <p className="text-[10px] font-mono text-zinc-500">Ready to upload with report</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={discardVoice}
              className="text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
            >
              <Trash2 size={16} />
            </Button>
          </div>
        )}
      </div>

      {/* Screenshot Attachments Section */}
      <div className="space-y-3 pt-2 border-t border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-extrabold uppercase tracking-widest text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
            <ImageIcon size={14} className="text-[#ff4e26]" />
            Screenshots (Max 5)
          </Label>
          <span className="text-[10px] font-mono font-bold text-zinc-500">{screenshots.length}/5 attached</span>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleScreenshotChange(e.target.files)}
        />

        {screenshotPreviews.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {screenshotPreviews.map((url, idx) => (
              <div key={idx} className="relative group aspect-square border-2 border-black dark:border-zinc-700 bg-zinc-100 overflow-hidden shadow-[2px_2px_0px_#000000]">
                {/* eslint-disable-next-html-element-suppression */}
                <img src={url} alt={`Screenshot ${idx + 1}`} className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeScreenshot(idx)}
                  className="absolute top-1 right-1 bg-black/80 text-white p-1 hover:bg-red-600 transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {screenshots.length < 5 && (
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            className="w-full border-2 border-black dark:border-zinc-700 py-5 font-extrabold uppercase tracking-wider text-xs shadow-[2px_2px_0px_#000000]"
          >
            <Upload size={16} className="mr-2 text-[#ff4e26]" /> Add Screenshot Images
          </Button>
        )}
      </div>

      {/* Error alert */}
      {error && (
        <div className="p-3 border-2 border-red-600 bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300 text-xs font-bold flex items-center gap-2 shadow-[2px_2px_0px_#000000]">
          <AlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Submit button */}
      <Button
        type="submit"
        disabled={isSubmitting}
        className="w-full py-3 bg-[#ff4e26] hover:bg-[#e03d16] text-white font-extrabold uppercase tracking-widest text-sm border-2 border-black shadow-[4px_4px_0px_#000000] disabled:opacity-50"
      >
        {isSubmitting ? (
          <span className="flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" /> Submitting Report...
          </span>
        ) : (
          "Send Support Report"
        )}
      </Button>
    </form>
  )
}
