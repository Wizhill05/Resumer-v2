"use client"

import { ProfileDialog } from "./ProfileDialog"
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
  return (
    <ProfileDialog label="Unsaved changes" busy={isSaving} onRequestClose={onCancel}>
      <div className="relative mx-auto w-full max-w-xl border border-line-strong bg-paper p-6 pixel-enter shadow-soft rounded-md">
        <button
          onClick={onCancel}
          aria-label="Close unsaved changes dialog"
          className="absolute top-4 right-4 text-ink-muted hover:text-ink dark:hover:text-white"
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-3 mb-3 text-amber-600 dark:text-amber-500">
          <AlertTriangle size={24} className="shrink-0" />
          <h3 className="text-lg font-bold text-ink">
            Unsaved Changes
          </h3>
        </div>

        <p className="text-sm text-ink-muted mb-6 leading-relaxed">
          You have unsaved edits in <span className="font-bold text-ink">{sectionName}</span>. What would you like to do before switching tabs?
        </p>

        <div className="flex flex-wrap flex-col md:flex-row gap-2 justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isSaving}
            className="w-full md:w-auto text-xs"
          >
            Keep Editing
          </Button>

          <Button
            type="button"
            variant="destructive"
            onClick={onDiscardAndContinue}
            disabled={isSaving}
            className="w-full md:w-auto text-xs"
          >
            Discard Edits
          </Button>

          <Button
            type="button"
            onClick={onSaveAndContinue}
            disabled={isSaving}
            className="w-full md:w-auto text-xs"
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
    </ProfileDialog>
  )
}
