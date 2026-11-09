"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { ArrowRight, X } from "lucide-react"
import { Button } from "@/components/ui/button"

type Action = { label: string; href?: string; onClick?: () => void }

/**
 * One-line "what to do next" nudge used across the onboarding flow.
 * Optional progress (e.g. 3 of 5) renders as a thin bar under the text.
 */
export function NextStepHint({
  eyebrow = "Next step",
  children,
  action,
  onDismiss,
  progress,
  className = "",
}: {
  eyebrow?: string
  children: ReactNode
  action?: Action
  onDismiss?: () => void
  progress?: { done: number; total: number }
  className?: string
}) {
  const button = action && (
    <Button size="sm" variant="outline" onClick={action.onClick} className="w-full sm:w-auto">
      {action.label}
      <ArrowRight size={14} aria-hidden="true" />
    </Button>
  )

  return (
    <div role="status" className={`relative overflow-hidden rounded-md border border-line bg-paper ${className}`}>
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
        <div className={`min-w-0 flex-1 ${onDismiss ? "pr-7 sm:pr-0" : ""}`}>
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-ink-muted">{eyebrow}</p>
          <p className="mt-0.5 text-sm text-ink">{children}</p>
        </div>
        {action && (action.href ? <Link href={action.href} className="shrink-0">{button}</Link> : <div className="shrink-0">{button}</div>)}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss tip"
            className="absolute right-2 top-2 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-ink-faint hover:bg-ink/5 hover:text-ink sm:static sm:shrink-0"
          >
            <X size={15} />
          </button>
        )}
      </div>
      {progress && (
        <div className="h-0.5 bg-ink/[0.06]" aria-hidden="true">
          <div className="h-full bg-ink/60 transition-[width] duration-500" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
        </div>
      )}
    </div>
  )
}
