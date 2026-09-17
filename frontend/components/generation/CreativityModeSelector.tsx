"use client"

import { useEffect, useRef, useState } from "react"
import { Info, X } from "lucide-react"

export type CreativityMode = "proper" | "larp" | "super_larp"

const MODE_LABELS: { val: CreativityMode; label: string }[] = [
  { val: "proper", label: "Proper" },
  { val: "larp", label: "LARP" },
  { val: "super_larp", label: "Super LARP" },
]

const MODE_INFO: { title: string; body: string }[] = [
  {
    title: "Proper — strictly your profile",
    body: "Writes only what your profile supports. Skills come from your profile; a job skill is included only if you plausibly demonstrate it. No invented tools, metrics, or features.",
  },
  {
    title: "LARP — embellish to match the job",
    body: "Keeps your real roles, companies, and project names, but freely adds job-required features, tools, and plausible metrics inside them. The skills section starts from the job's required skills so nothing the posting asks for is missing. Each run is written creatively so resumes don't all read the same.",
  },
  {
    title: "Super LARP — plus an invented hero project",
    body: "Everything LARP does, and the first project slot is replaced with a brand-new project invented to mirror the job description as closely as possible. Remaining slots still use your real projects.",
  },
]

export function CreativityModeSelector({
  value,
  onChange,
  compact = false,
}: {
  value: CreativityMode
  onChange: (v: CreativityMode) => void
  compact?: boolean
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
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Generation mode</span>
        <button
          type="button"
          onClick={() => setShowInfo(true)}
          aria-label="What do the generation modes do?"
          className="flex h-4 w-4 items-center justify-center rounded-full border border-zinc-300 text-[10px] font-black text-zinc-500 transition-colors hover:border-zinc-500 hover:text-zinc-800 dark:border-zinc-600 dark:text-zinc-400 dark:hover:text-zinc-100 cursor-pointer"
        >
          <Info size={10} />
        </button>
      </div>

      <div className="relative py-0.5 px-0.5 -mx-0.5 overflow-visible">
        <div
          key={boostTrigger}
          className={`grid grid-cols-3 gap-1.5 text-xs font-bold transition-transform ${
            boostTrigger > 0 ? "super-larp-thruster" : ""
          }`}
          onAnimationEnd={() => setBoostTrigger(0)}
        >
          {MODE_LABELS.map((opt) => {
            const isSelected = value === opt.val
            const isSuperLarp = opt.val === "super_larp"

            let buttonClass =
              "border py-1.5 text-center transition-colors cursor-pointer select-none "
            if (isSelected) {
              if (isSuperLarp) {
                buttonClass +=
                  "border-[#ff4e26] bg-[#ff4e26] text-white shadow-sm font-black dark:border-[#ff4e26] dark:bg-[#ff4e26]"
              } else {
                buttonClass +=
                  "border-zinc-950 dark:border-zinc-400 bg-zinc-950 dark:bg-zinc-700 text-white"
              }
            } else {
              if (isSuperLarp) {
                buttonClass +=
                  "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-[#ff4e26]/60 hover:text-[#ff4e26]"
              } else {
                buttonClass +=
                  "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-zinc-400"
              }
            }

            return (
              <button
                key={opt.val}
                type="button"
                onClick={() => handleSelect(opt.val)}
                className={buttonClass}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {!compact && (
        <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
          Proper: only your profile facts. LARP: embellishes details + prioritizes job skills. Super LARP: LARP plus an invented job-focused first project.
        </p>
      )}

      {showInfo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowInfo(false)}
        >
          <div
            className="w-full max-w-md space-y-3 rounded-lg border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold uppercase tracking-wide">Generation modes</h3>
              <button
                type="button"
                onClick={() => setShowInfo(false)}
                aria-label="Close"
                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3">
              {MODE_INFO.map((m) => (
                <div key={m.title}>
                  <p className="text-xs font-bold">{m.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{m.body}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-500">
              Applies to the summary, skills, experience bullets, and project sections. Your default mode can be
              changed anytime under Profile → Defaults; each generation can still override it for that run only.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
