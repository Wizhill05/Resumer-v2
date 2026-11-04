import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { AgentMarks } from "@/components/landing/AgentMarks"

/**
 * Small "how your agent works with RéSUMER" section for the landing page.
 * Placed after the StoryJourney / StoryTransformation block. Focus: how the
 * agent helps build your résumé, not a full taxonomy of supported tools.
 */
export function AgentSection() {
  return (
    <section
      aria-labelledby="agent-section-heading"
      className="relative overflow-hidden border-y border-zinc-200 px-5 py-16 sm:py-20 dark:border-zinc-800"
    >
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-xs font-mono font-bold uppercase tracking-widest text-[var(--fluid-ink-soft)] dark:text-zinc-400">
          Or let your agent do it
        </p>
        <h2
          id="agent-section-heading"
          className="mt-4 text-balance text-3xl font-black leading-[1.12] tracking-tight text-[var(--fluid-ink)] sm:text-4xl dark:text-zinc-50"
        >
          How your agent works with RéSUMER
        </h2>
        <div className="mt-5 flex items-center justify-center gap-3 text-[var(--fluid-ink)] dark:text-zinc-50">
          <AgentMarks />
        </div>
        <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-[var(--fluid-ink-soft)] sm:text-base dark:text-zinc-300">
          Paste one prompt into your local coding agent. It connects to
          RéSUMER, checks your profile, and guides you through the rest —
          tailored to each tool. Then give it a job description and it
          generates your ATS-safe résumé PDF.
        </p>
        <div className="mt-8">
          <Link
            href="/agent"
            className="group inline-flex items-center gap-2 border border-[var(--fluid-ink)]/25 bg-white/40 px-4 py-2 text-sm font-semibold text-[var(--fluid-ink)] backdrop-blur-sm transition-colors hover:border-[var(--fluid-ink)]/50 hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fluid-ink)] dark:border-white/25 dark:bg-white/5 dark:text-zinc-50 dark:hover:border-white/50 dark:hover:bg-white/10 dark:focus-visible:outline-white"
          >
            <span>Connect your agent</span>
            <ArrowUpRight
              size={14}
              className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            />
          </Link>
        </div>
      </div>
    </section>
  )
}
