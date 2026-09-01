"use client"

import { useState } from "react"
import { ChevronDown, ExternalLink, FileText } from "lucide-react"

const FAQS: { q: string; a: string }[] = [
  {
    q: "Generation failed",
    a: "Check you have enough projects/experiences for the split. Retry once, then use the Report button on the failed card — it includes the run ID.",
  },
  {
    q: "PDF too cramped",
    a: "Try 2 projects + 2 experiences, shorten bullets, or edit and re-export. Attach a screenshot if it still breaks.",
  },
  {
    q: "Import found nothing",
    a: "Use a text-based PDF (not a scan). Export from Docs/Word and re-import.",
  },
  {
    q: "GitHub import empty",
    a: "Repos must be public and username correct. Report with the username if it still fails.",
  },
]

export function SupportFaq() {
  const [openIdx, setOpenIdx] = useState<number | null>(0)

  return (
    <div className="space-y-3">
      <div className="border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
        <h3 className="text-xs font-black uppercase tracking-widest">Quick fixes</h3>
        <div className="mt-3 space-y-1.5">
          {FAQS.map((faq, idx) => {
            const open = openIdx === idx
            return (
              <div key={faq.q} className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/40">
                <button
                  type="button"
                  onClick={() => setOpenIdx(open ? null : idx)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                >
                  <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">{faq.q}</span>
                  <ChevronDown size={14} className={`shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`} />
                </button>
                {open && <p className="px-3 pb-2.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{faq.a}</p>}
              </div>
            )
          })}
        </div>
      </div>

      <div className="border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
        <h3 className="text-xs font-black uppercase tracking-widest">Other ways</h3>
        <div className="mt-3 grid gap-2">
          <a
            href="https://github.com/Wizhill05/resumer-v2/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-xs font-bold hover:border-zinc-900 dark:hover:border-zinc-500 transition-colors"
          >
            <span className="flex items-center gap-2">
              <ExternalLink size={14} /> GitHub issues
            </span>
            <span className="text-[10px] font-mono text-zinc-400">→</span>
          </a>
          <a
            href="/privacy"
            className="flex items-center justify-between border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-xs font-bold hover:border-zinc-900 dark:hover:border-zinc-500 transition-colors"
          >
            <span className="flex items-center gap-2">
              <FileText size={14} /> Privacy
            </span>
            <span className="text-[10px] font-mono text-zinc-400">→</span>
          </a>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          Reports from error banners auto-fill context. Include your email if you want a follow-up.
        </p>
      </div>
    </div>
  )
}
