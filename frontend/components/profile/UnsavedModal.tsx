"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { AlertTriangle, Loader2, X } from "lucide-react"

interface UnsavedModalProps {
  onSaveAndContinue: () => void
  onDiscardAndContinue: () => void
  onCancel: () => void
  isSaving?: boolean
  sectionName?: string
}

export function UnsavedModal({
  onSaveAndContinue,
  onDiscardAndContinue,
  onCancel,
  isSaving = false,
  sectionName = "current section",
}: UnsavedModalProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel()
    }
    window.addEventListener("keydown", handleKeyDown)

    return () => {
      document.body.style.overflow = originalOverflow
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [onCancel])

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs font-mono">
      <div className="relative w-full max-w-md border-2 border-black dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6 shadow-[4px_4px_0px_#000000] dark:shadow-[4px_4px_0px_#3f3f46] pixel-enter">
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 text-zinc-500 hover:text-black dark:hover:text-white"
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-3 mb-3 text-amber-600 dark:text-amber-500">
          <AlertTriangle size={24} className="shrink-0" />
          <h3 className="text-lg font-black uppercase tracking-wide text-black dark:text-white">
            Unsaved Changes
          </h3>
        </div>

        <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-6 leading-relaxed">
          You have unsaved edits in <span className="font-bold text-black dark:text-white">{sectionName}</span>. What would you like to do before switching tabs?
        </p>

        <div className="flex flex-col sm:flex-row gap-2 justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isSaving}
            className="w-full sm:w-auto text-xs"
          >
            Keep Editing
          </Button>

          <Button
            type="button"
            variant="destructive"
            onClick={onDiscardAndContinue}
            disabled={isSaving}
            className="w-full sm:w-auto text-xs"
          >
            Discard Edits
          </Button>

          <Button
            type="button"
            onClick={onSaveAndContinue}
            disabled={isSaving}
            className="w-full sm:w-auto text-xs"
          >
            {isSaving ? (
              <>
                <Loader2 className="animate-spin" size={14} /> Saving...
              </>
            ) : (
              "Save & Continue"
            )}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
