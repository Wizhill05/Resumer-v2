"use client"

import { Loader2, Check, AlertCircle } from "lucide-react"

export type SaveStatus = "draft" | "saved" | "saving" | "unsaved" | "error"

interface SaveStatusBadgeProps {
  status: SaveStatus
  onSaveNow?: () => void
  errorMessage?: string
  className?: string
}

const base = "inline-flex flex-wrap items-center gap-1.5 text-xs font-semibold"

export function SaveStatusBadge({ status, onSaveNow, errorMessage, className = "" }: SaveStatusBadgeProps) {
  if (status === "draft") return <span className={`${base} text-ink-muted ${className}`}>Not saved yet</span>

  if (status === "saving") {
    return (
      <span role="status" aria-live="polite" className={`${base} text-ink-soft ${className}`}>
        <Loader2 className="animate-spin text-ember" size={14} aria-hidden="true" />
        Saving…
      </span>
    )
  }

  if (status === "saved") {
    return (
      <span role="status" aria-live="polite" className={`${base} text-ink-soft ${className}`}>
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-b from-[#ff6a45] to-[#ff4e26] text-white">
          <Check size={10} strokeWidth={3.5} aria-hidden="true" />
        </span>
        All changes saved
      </span>
    )
  }

  if (status === "error") {
    return (
      <span role="status" aria-live="polite" className={`${base} text-red-700 dark:text-red-300 ${className}`} title={errorMessage}>
        <AlertCircle size={14} className="text-red-600 dark:text-red-400" aria-hidden="true" />
        Couldn&apos;t save
        {onSaveNow && (
          <button type="button" onClick={onSaveNow} className="cursor-pointer underline underline-offset-2 hover:text-ink">
            Retry
          </button>
        )}
      </span>
    )
  }

  // unsaved
  return (
    <span role="status" aria-live="polite" className={`${base} text-ink-soft ${className}`}>
      <span className="h-2 w-2 animate-pulse rounded-full bg-ember" aria-hidden="true" />
      Unsaved changes
      {onSaveNow && (
        <button type="button" onClick={onSaveNow} className="cursor-pointer text-ember underline-offset-2 hover:underline">
          Save now
        </button>
      )}
    </span>
  )
}
