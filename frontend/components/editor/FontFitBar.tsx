"use client"

import { useState } from "react"
import { Type, FileText } from "lucide-react"

type Props = {
  fontPt: number
  pageCount: number
  fits: boolean
  minFontSize: number
  maxFontSize: number
  targetPages: number
}

export function FontFitBar({ fontPt, pageCount, fits, minFontSize, maxFontSize, targetPages }: Props) {
  const [showTooltip, setShowTooltip] = useState(false)

  // 0–100 progress where min_font_size = 0%, max_font_size = 100%
  const range = maxFontSize - minFontSize
  const pct = range > 0 ? Math.round(((fontPt - minFontSize) / range) * 100) : 50
  const clampedPct = Math.max(0, Math.min(100, pct))

  // Colors based on fit state
  const barColor = !fits ? "#ef4444" : clampedPct > 60 ? "#22c55e" : clampedPct > 30 ? "#f59e0b" : "#ef4444"
  const pillBg = !fits ? "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800" : "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800"
  const pagePillBg = pageCount > targetPages
    ? "bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800"
    : "bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700"

  return (
    <div
      className="relative flex items-center gap-2"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Font size pill + bar */}
      <div className="flex items-center gap-1.5">
        <Type size={12} className="text-zinc-400 shrink-0" />
        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded border ${pillBg}`}>
          {fontPt.toFixed(1)}pt
        </span>

        {/* Range bar */}
        <div className="w-16 h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden" title={`${minFontSize}pt – ${maxFontSize}pt`}>
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${clampedPct}%`, background: barColor }}
          />
        </div>
      </div>

      {/* Page count pill */}
      <div className="flex items-center gap-1">
        <FileText size={12} className="text-zinc-400 shrink-0" />
        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded border ${pagePillBg}`}>
          {pageCount} {pageCount === 1 ? "page" : "pages"}
          {pageCount > targetPages && " !"}
        </span>
      </div>

      {/* Hover tooltip */}
      {showTooltip && (
        <div className="absolute top-full right-0 mt-1.5 z-50 w-64 p-2.5 bg-zinc-900 dark:bg-zinc-800 text-white text-[11px] leading-relaxed rounded shadow-lg">
          <p className="font-medium mb-1">Automatic font sizing</p>
          <p className="text-zinc-300">
            Text size adjusts between {minFontSize}pt (min) and {maxFontSize}pt (max) to fit your content on {targetPages} {targetPages === 1 ? "page" : "pages"}.
            The bar shows where the current size falls in that range.
          </p>
          <p className="mt-1.5 text-zinc-300">
            Delete some words/bullets to make the font size bigger.
          </p>
          {!fits && (
            <p className="mt-1.5 text-red-300">
              Content overflows even at minimum size. Remove text or shorten bullets to fit.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
