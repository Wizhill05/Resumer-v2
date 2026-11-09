"use client"

import { useState } from "react"
import { Info, X } from "lucide-react"

export type CreativityMode = "proper" | "larp" | "super_larp"

export const MODE_LABELS: { val: CreativityMode; label: string }[] = [
  { val: "proper", label: "Proper" },
  { val: "larp", label: "LARP" },
  { val: "super_larp", label: "Super LARP" },
]

const MODE_HINTS: Record<CreativityMode, string> = {
  proper: "Only what's in your profile",
  larp: "Reframes and fills small gaps",
  super_larp: "Adds an invented hero project",
}

export const MODE_INFO: { title: string; body: string }[] = [
  {
    title: "Proper: strictly your profile",
    body: "Writes only what your profile supports. Skills come from your profile; a job skill is included only if you plausibly demonstrate it. No invented tools, metrics, or features.",
  },
  {
    title: "LARP: embellish to match the job",
    body: "Keeps your real roles, companies, and project names, but freely adds job-required features, tools, and plausible metrics inside them. The skills section starts from the job's required skills so nothing the posting asks for is missing. Each run is written creatively so résumés don't all read the same.",
  },
  {
    title: "Super LARP: plus an invented hero project",
    body: "Everything LARP does, and the first project slot is replaced with a brand-new project invented to mirror the job description as closely as possible. Remaining slots still use your real projects.",
  },
]

export function CreativityModeSelector({
  value,
  onChange,
  compact = false,
  showLabel = true,
}: {
  value: CreativityMode
  onChange: (v: CreativityMode) => void
  compact?: boolean
  showLabel?: boolean
}) {
  const [showInfo, setShowInfo] = useState(false)
  const [boostTrigger, setBoostTrigger] = useState(0)

  const handleSelect = (v: CreativityMode) => {
    onChange(v)
    if (v === "super_larp") {
      setBoostTrigger((prev) => prev + 1)
    }
  }

  return (
    <div className="space-y-2">
      {showLabel && (
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-ink">Generation mode</span>
          <button
            type="button"
            onClick={() => setShowInfo(true)}
            aria-label="What do the generation modes do?"
            className="flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border border-line text-ink-muted transition-colors hover:border-ink/40 hover:text-ink"
          >
            <Info size={10} />
          </button>
        </div>
      )}
      <div
        key={boostTrigger}
        role="radiogroup"
        aria-label="Generation mode"
        className={`grid grid-cols-3 gap-1 rounded-md border border-line bg-ink/[0.04] p-1 transition-transform ${
          boostTrigger > 0 ? "super-larp-thruster" : ""
        }`}
        onAnimationEnd={() => setBoostTrigger(0)}
      >
        {MODE_LABELS.map((opt) => {
          const isSelected = value === opt.val
          return (
            <button
              key={opt.val}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => handleSelect(opt.val)}
              className={`cursor-pointer select-none rounded-[4px] text-left transition-[background-color,box-shadow,color] ${
                compact ? "px-2 py-1.5 text-center text-xs" : "px-3 py-2.5"
              } ${
                isSelected
                  ? "bg-paper text-ink shadow-[0_1px_2px_rgb(35_10_4/8%),0_4px_12px_-4px_rgb(35_10_4/18%)]"
                  : "text-ink/70 hover:bg-paper/60 hover:text-ink"
              }`}
            >
              <span className={`flex items-center gap-1.5 font-semibold ${compact ? "justify-center" : "text-sm"}`}>
                {isSelected && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ember" />}
                {opt.label}
              </span>
              {!compact && <span className="mt-0.5 block text-xs text-ink-muted">{MODE_HINTS[opt.val]}</span>}
            </button>
          )
        })}
      </div>
      {!showLabel && (
        <button
          type="button"
          onClick={() => setShowInfo(true)}
          className="inline-flex cursor-pointer items-center gap-1 text-xs font-semibold text-ink-soft hover:text-ink"
        >
          <Info size={12} aria-hidden="true" /> What do the modes do?
        </button>
      )}
      {showInfo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(35_10_4/38%)] dark:bg-black/60 p-4"
          onClick={() => setShowInfo(false)}
        >
          <div
            className="w-full max-w-md space-y-3 rounded-lg border border-line bg-paper p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">Generation modes</h3>
              <button
                type="button"
                onClick={() => setShowInfo(false)}
                aria-label="Close"
                className="text-ink-faint hover:text-ink cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3">
              {MODE_INFO.map((m) => (
                <div key={m.title}>
                  <p className="text-xs font-bold">{m.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{m.body}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-ink-muted">
              Applies to the summary, skills, experience bullets, and project sections. Your default mode can be
              changed anytime under Profile → Defaults; each generation can still override it for that run only.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
