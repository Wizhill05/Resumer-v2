import Link from "next/link"
import { InlineAuthPanel } from "@/components/landing/InlineAuthPanel"
import { ArrowUpRight, FileText } from "lucide-react"

export function HeroSection() {
  return (
    <section className="relative flex w-full min-h-screen md:h-screen md:h-[100dvh] md:min-h-[100dvh] flex-col justify-between overflow-hidden px-4 py-6 md:py-4 sm:px-6 lg:px-8 bg-[#fbfbf3] dark:bg-zinc-900">
      {/* Structural Industrial Crosshairs Corner Accents */}
      <div className="absolute top-3 left-3 text-zinc-400 dark:text-zinc-700 font-mono text-xs select-none pointer-events-none">
        +
      </div>
      <div className="absolute top-3 right-3 text-zinc-400 dark:text-zinc-700 font-mono text-xs select-none pointer-events-none">
        +
      </div>
      <div className="absolute bottom-3 left-3 text-zinc-400 dark:text-zinc-700 font-mono text-xs select-none pointer-events-none">
        +
      </div>
      <div className="absolute bottom-3 right-3 text-zinc-400 dark:text-zinc-700 font-mono text-xs select-none pointer-events-none">
        +
      </div>

      {/* Top Nav Bar inside Hero */}
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between border-b-2 border-black dark:border-zinc-800 pb-3">
        <div className="flex items-center gap-3">
          {/* Logo with sharp border and ZERO blurred shadows */}
          <div className="resumer-mark px-3 py-1 text-base font-black">
            <span className="text-lg font-extrabold uppercase tracking-tight text-zinc-900 dark:text-zinc-100">
              RESUMER
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <Link
            href="/try"
            className="inline-flex items-center gap-1 text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-100 hover:text-[#ff4e26] dark:hover:text-[#ff4e26] transition-colors"
          >
            Try Guest Mode <ArrowUpRight size={14} />
          </Link>
        </div>
      </div>

      {/* Main Hero Body — Side by Side on Desktop (2 Columns) */}
      <div className="relative mx-auto my-auto w-full max-w-7xl py-4 sm:py-6 border border-dashed border-zinc-300/60 dark:border-zinc-800/60 p-5 sm:p-6 lg:p-8">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 lg:gap-10 items-center">
          {/* Left Column: Headline & Subheadline */}
          <div className="md:col-span-7 lg:col-span-7 flex flex-col justify-center">
            {/* Main Headline */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black uppercase tracking-[-0.04em] text-zinc-900 dark:text-white leading-[0.95] mb-4">
              TAILOR YOUR <span className="text-[#ff4e26]">RESUME</span> FOR ANY JOB.
            </h1>

            {/* 1-Sentence Subtitle */}
            <p className="text-base sm:text-lg font-bold text-zinc-600 dark:text-zinc-300 max-w-xl mb-6 leading-relaxed">
              Paste a job posting. Resumer extracts target signals and generates a high-match ATS PDF in seconds.
            </p>

            {/* Monochromatic ATS Platform Icons Row */}
            <div className="space-y-2">
              <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 dark:text-zinc-400 font-bold">
                COMPATIBLE WITH TOP ATS PARSERS
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* Workday Logo Icon */}
                <div className="flex items-center gap-1.5 border border-zinc-300 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-2.5 py-1 text-xs font-mono font-bold text-zinc-700 dark:text-zinc-300">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>
                  <span>Workday</span>
                </div>

                {/* Greenhouse Logo Icon */}
                <div className="flex items-center gap-1.5 border border-zinc-300 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-2.5 py-1 text-xs font-mono font-bold text-zinc-700 dark:text-zinc-300">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                  <span>Greenhouse</span>
                </div>

                {/* Lever Logo Icon */}
                <div className="flex items-center gap-1.5 border border-zinc-300 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-2.5 py-1 text-xs font-mono font-bold text-zinc-700 dark:text-zinc-300">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
                  <span>Lever</span>
                </div>

                {/* Ashby Logo Icon */}
                <div className="flex items-center gap-1.5 border border-zinc-300 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-2.5 py-1 text-xs font-mono font-bold text-zinc-700 dark:text-zinc-300">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>
                  <span>Ashby</span>
                </div>

                {/* PDF Output Badge */}
                <div className="flex items-center gap-1.5 border border-zinc-300 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-2.5 py-1 text-xs font-mono font-bold text-zinc-700 dark:text-zinc-300">
                  <FileText size={14} />
                  <span>1-Page PDF</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Inline Auth Panel Side-by-Side on Desktop */}
          <div className="md:col-span-5 lg:col-span-5 flex justify-center md:justify-end">
            <InlineAuthPanel callbackUrl="/dashboard" />
          </div>
        </div>
      </div>

      {/* Bottom Accent Line */}
      <div className="mx-auto w-full max-w-7xl border-t border-dashed border-zinc-300 dark:border-zinc-800 pt-2 flex justify-between items-center text-[10px] font-mono uppercase text-zinc-500 dark:text-zinc-400">
        <span>RESUMER V2.0</span>
        <span>SCROLL FOR DETAILS ↓</span>
      </div>
    </section>
  )
}
