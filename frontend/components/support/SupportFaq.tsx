"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronDown, ExternalLink, FileText, Sparkles } from "lucide-react"

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
    a: "Use a text-based PDF (not scan). Export from Docs/Word and re-import.",
  },
  {
    q: "GitHub import empty",
    a: "Repos must be public and username correct. Report with the username if it still fails.",
  },
  {
    q: "How do I use Résumer with an AI agent?",
    a: "Open /agent, copy the prompt, and give it to your AI agent. Follow the sign-in link it provides to connect your account.",
  },
]

export function SupportFaq() {
  const [openIdx, setOpenIdx] = useState<number | null>(0)

  return (
    <div className="space-y-3">
      <div className="border border-line bg-paper p-4 rounded-md">
        <h3 className="text-xs font-bold">Quick fixes</h3>
        <div className="mt-3 space-y-1.5">
          {FAQS.map((faq, idx) => {
            const open = openIdx === idx
            return (
              <div key={faq.q} className="border border-line bg-ink/[0.03] dark:bg-ink/[0.06] rounded-md">
                <button
                  type="button"
                  onClick={() => setOpenIdx(open ? null : idx)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                >
                  <span className="text-sm font-semibold text-ink">{faq.q}</span>
                  <ChevronDown size={14} className={`shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} />
                </button>
                {open && <p className="px-3 pb-2.5 text-xs leading-relaxed text-ink-muted">{faq.a}</p>}
              </div>
            )
          })}
        </div>
      </div>

      <div className="border border-line bg-paper p-4 rounded-md">
        <h3 className="text-xs font-bold">Other ways</h3>
        <div className="mt-3 grid gap-2">
          <Link
            href="/agent"
            className="flex items-center justify-between border border-line bg-ink/[0.03] px-3 py-2.5 text-xs font-bold hover:border-ink/40 dark:hover:border-ember/50 transition-colors rounded-md"
          >
            <span className="flex items-center gap-2">
              <Sparkles size={14} /> Connect an agent
            </span>
            <span className="text-[10px] text-ink-faint">→</span>
          </Link>
          <a
            href="https://github.com/Wizhill05/resumer-v2/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between border border-line bg-ink/[0.03] px-3 py-2.5 text-xs font-bold hover:border-ink/40 dark:hover:border-ember/50 transition-colors rounded-md"
          >
            <span className="flex items-center gap-2">
              <ExternalLink size={14} /> GitHub issues
            </span>
            <span className="text-[10px] text-ink-faint">→</span>
          </a>
          <a
            href="/privacy"
            className="flex items-center justify-between border border-line bg-ink/[0.03] px-3 py-2.5 text-xs font-bold hover:border-ink/40 dark:hover:border-ember/50 transition-colors rounded-md"
          >
            <span className="flex items-center gap-2">
              <FileText size={14} /> Privacy
            </span>
            <span className="text-[10px] text-ink-faint">→</span>
          </a>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-muted">
          Reports from error banners auto-fill context. Include your email if you want a follow-up.
        </p>
      </div>
    </div>
  )
}
