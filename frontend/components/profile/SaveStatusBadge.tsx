"use client"

import { Loader2, Check, AlertCircle } from "lucide-react"

export type SaveStatus = "saved" | "saving" | "unsaved" | "error"

interface SaveStatusBadgeProps {
  status: SaveStatus
  onSaveNow?: () => void
  errorMessage?: string
}

export function SaveStatusBadge({ status, onSaveNow, errorMessage }: SaveStatusBadgeProps) {
  if (status === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-extrabold border-2 border-black dark:border-zinc-700 bg-amber-100 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 shadow-[2px_2px_0px_#000000]">
        <Loader2 className="animate-spin" size={13} />
        Saving...
      </span>
    )
  }

  if (status === "saved") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-extrabold border-2 border-black dark:border-zinc-700 bg-emerald-100 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200 shadow-[2px_2px_0px_#000000]">
        <Check size={13} className="text-emerald-600 dark:text-emerald-400 stroke-[3]" />
        All changes saved
      </span>
    )
  }

  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-extrabold border-2 border-black dark:border-zinc-700 bg-red-100 dark:bg-red-950/50 text-red-900 dark:text-red-200 shadow-[2px_2px_0px_#000000]" title={errorMessage}>
        <AlertCircle size={13} className="text-red-600 dark:text-red-400" />
        Error saving
        {onSaveNow && (
          <button
            type="button"
            onClick={onSaveNow}
            className="underline ml-1 hover:text-black dark:hover:text-white font-extrabold cursor-pointer"
          >
            Retry
          </button>
        )}
      </span>
    )
  }

  // unsaved
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-extrabold border-2 border-black dark:border-zinc-700 bg-amber-50 dark:bg-amber-950/30 text-zinc-900 dark:text-zinc-100 shadow-[2px_2px_0px_#000000]">
      <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
      Unsaved changes
      {onSaveNow && (
        <button
          type="button"
          onClick={onSaveNow}
          className="ml-1 text-[#ff4e26] dark:text-[#d65235] hover:underline font-extrabold cursor-pointer"
        >
          Save Now
        </button>
      )}
    </span>
  )
}
