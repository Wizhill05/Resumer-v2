"use client"

import { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Star, X, Check, HeartHandshake } from "lucide-react"

interface FeedbackModalProps {
  generationId?: string
  onClose: () => void
}

export function FeedbackModal({ generationId, onClose }: FeedbackModalProps) {
  const [rating, setRating] = useState<number>(0)
  const [hoverRating, setHoverRating] = useState<number>(0)
  const [comment, setComment] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDismiss = () => {
    try {
      localStorage.setItem("resumer_feedback_prompted", "true")
    } catch {}
    fetch("/api/backend/feedback/rating/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generation_id: generationId || null }),
    }).catch(() => {})
    onClose()
  }

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleDismiss()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [handleDismiss])

  // Lock body scroll while modal is active
  useEffect(() => {
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = ""
    }
  }, [])

  const handleSubmit = async () => {
    if (rating === 0) {
      setError("Please select a star rating.")
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      try {
        localStorage.setItem("resumer_feedback_prompted", "true")
      } catch {}
      const res = await fetch("/api/backend/feedback/rating", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          star_rating: rating,
          comment: comment.trim() || null,
          generation_id: generationId || null,
          shown_at: new Date().toISOString(),
        }),
      })

      if (!res.ok) {
        throw new Error("Failed to submit rating")
      }

      setSubmitted(true)
      setTimeout(() => {
        onClose()
      }, 2000)
    } catch (err) {
      console.error(err)
      setError("Could not save your rating. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  if (typeof document === "undefined") return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Rate your experience"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[rgb(35_10_4/38%)] dark:bg-black/60 backdrop-blur-xs transition-opacity"
        onClick={handleDismiss}
      />

      {/* Modal Container */}
      <div className="relative z-10 w-full max-w-md border border-line-strong bg-paper p-6 sm:p-8 animate-in fade-in zoom-in-95 duration-200 shadow-soft rounded-md">
        <button
          onClick={handleDismiss}
          className="absolute top-4 right-4 p-1 text-ink-muted hover:text-ink dark:hover:text-white transition-colors"
          aria-label="Close"
        >
          <X size={20} />
        </button>

        {submitted ? (
          <div className="py-6 text-center space-y-4">
            <div className="mx-auto w-14 h-14 bg-emerald-500 text-white rounded-full flex items-center justify-center border border-line-strong shadow-soft">
              <Check size={32} />
            </div>
            <h3 className="text-xl font-bold tracking-tight">Thank You!</h3>
            <p className="text-sm font-medium text-ink-muted">
              Your feedback helps us make Résumer even better.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-[#ff4e26]/10 dark:bg-[#ff4e26]/15 text-[#ff4e26] border border-[#ff4e26] text-xs font-bold rounded-md">
                <HeartHandshake size={14} />
                <span>Feedback & Rating</span>
              </div>
              <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
                Tell us about your experience
              </h2>
              <p className="text-xs font-medium text-ink-muted">
                How satisfied are you with your generated résumé?
              </p>
            </div>

            {/* Star Rating Interactive Selector */}
            <div className="flex items-center justify-center gap-2 py-2">
              {[1, 2, 3, 4, 5].map((star) => {
                const active = star <= (hoverRating || rating)
                return (
                  <button
                    key={star}
                    type="button"
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    onClick={() => setRating(star)}
                    className="p-1.5 text-ink-faint hover:scale-110 active:scale-95 transition-all"
                  >
                    <Star
                      size={36}
                      className={
                        active
                          ? "fill-ember text-ember drop-shadow-[0_4px_10px_rgb(255_78_38/40%)]"
                          : "text-ink-faint"
                      }
                    />
                  </button>
                )
              })}
            </div>

            {/* Comment textarea */}
            <div className="space-y-2">
              <label htmlFor="comment" className="text-xs font-bold text-ink-muted">
                Any quick thoughts or suggestions? (Optional)
              </label>
              <Textarea
                id="comment"
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="What did you love or where can we improve?"
                className="border border-line-strong font-sans text-sm shadow-soft rounded-md"
              />
            </div>

            {error && (
              <p className="text-xs font-bold text-red-600 dark:text-red-400 text-center">{error}</p>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="flex-1 border border-line-strong font-bold text-xs rounded-md"
              >
                Skip
              </Button>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting || rating === 0}
                className="flex-1 bg-[#ff4e26] hover:bg-[#e03d16] dark:hover:bg-[#e03d16] text-white font-bold text-xs border border-line-strong disabled:opacity-50 shadow-soft rounded-md"
              >
                {isSubmitting ? "Submitting..." : "Submit Rating"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
