import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
interface FooterProps {
  variant?: "landing" | "simple"
}

export function Footer({ variant = "simple" }: FooterProps) {
  if (variant === "simple") {
    return (
      <footer className="mt-auto border-t border-black/10 bg-[var(--fluid-canvas)] text-[var(--fluid-ink)] min-h-[40vh] sm:min-h-[40dvh] flex flex-col justify-between pt-12 pb-8 px-4 sm:px-6 md:px-8 font-sans dark:border-white/10 dark:bg-[#121214] dark:text-white">
        <div className="mx-auto max-w-6xl w-full flex-1 flex flex-col justify-between">
          {/* Top row: Brand & Navigation */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 pb-8 border-b border-black/10 dark:border-zinc-800/80">
            <div className="space-y-1">
              <Link
                href="/dashboard"
                className="text-lg font-black tracking-tight text-[var(--fluid-ink)] hover:opacity-80 transition-opacity dark:text-white"
              >
                R<span className="normal-case">é</span>SUMER
              </Link>
              <p className="text-[11px] font-mono font-medium text-[var(--fluid-ink-soft)] uppercase tracking-wider dark:text-zinc-400">
                ATS Résumé Tailoring Engine
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-5 sm:gap-6 text-xs font-mono font-bold uppercase tracking-wider">
              <Link
                href="/agent"
                className="text-[var(--fluid-ink)]/70 hover:text-[#ff4e26] transition-colors dark:text-zinc-300"
              >
                Agent
              </Link>
              <Link
                href="/support"
                className="text-[var(--fluid-ink)]/70 hover:text-[#ff4e26] transition-colors dark:text-zinc-300"
              >
                Support
              </Link>
              <Link
                href="/privacy"
                className="text-[var(--fluid-ink)]/70 hover:text-[#ff4e26] transition-colors dark:text-zinc-300"
              >
                Privacy
              </Link>
              <a
                href="https://github.com/Wizhill05/resumer-v2"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[var(--fluid-ink)]/70 hover:text-[#ff4e26] transition-colors dark:text-zinc-300"
              >
                <span>GitHub</span>
                <ArrowUpRight size={12} />
              </a>
            </div>
          </div>

          {/* Middle: Subtle giant watermark display */}
          <div className="group my-auto py-8 sm:py-10 text-center select-none cursor-pointer overflow-hidden">
            <span className="text-[4rem] sm:text-[6rem] md:text-[7rem] font-black uppercase tracking-tighter text-black/[0.06] leading-none block transition-all duration-700 ease-out group-hover:text-[#ff4e26] group-hover:scale-105 dark:text-white/[0.07]">
              R<span className="normal-case">é</span>sumer
            </span>
          </div>

          {/* Bottom Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-6 border-t border-black/10 text-xs font-mono text-[var(--fluid-ink-soft)]/80 dark:border-zinc-800/80 dark:text-zinc-500">
            <span>© {new Date().getFullYear()} RéSUMER. ALL RIGHTS RESERVED.</span>
            <span>BUILT FOR PRECISION</span>
          </div>
        </div>
      </footer>
    )
  }

  return (
    <footer className="mt-auto border-t border-black/10 bg-[var(--fluid-canvas)] text-[var(--fluid-ink)] min-h-[40vh] sm:min-h-[40dvh] flex flex-col justify-between pt-16 pb-10 px-5 sm:px-6 lg:px-8 font-sans dark:border-white/10 dark:bg-[#121214] dark:text-white">
      <div className="mx-auto max-w-7xl w-full flex-1 flex flex-col justify-between">
        {/* Main Minimal Link Row */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 pb-10 border-b border-black/10 dark:border-zinc-800/80">
          {/* Left: Brand mark */}
          <div className="space-y-2">
            <Link
              href="/"
              className="text-lg font-black tracking-tight text-[var(--fluid-ink)] hover:opacity-80 transition-opacity dark:text-white"
            >
              R<span className="normal-case">é</span>SUMER
            </Link>
            <p className="text-xs font-mono font-medium text-[var(--fluid-ink-soft)] uppercase tracking-wider dark:text-zinc-400">
              ATS Résumé Tailoring Engine
            </p>
          </div>

          {/* Right: Minimal Navigation */}
          <div className="flex flex-wrap items-center gap-6 sm:gap-8 text-xs font-mono font-bold uppercase tracking-wider">
            <Link
              href="/agent"
              className="text-[var(--fluid-ink)]/70 hover:text-[#ff4e26] transition-colors dark:text-zinc-300"
            >
              Agent
            </Link>
            <Link
              href="/try"
              className="inline-flex items-center gap-1 text-[var(--fluid-ink)]/70 hover:text-[#ff4e26] transition-colors dark:text-zinc-300"
            >
              <span>Guest Mode</span>
              <ArrowUpRight size={14} />
            </Link>
            <Link
              href="/privacy"
              className="text-[var(--fluid-ink)]/70 hover:text-[#ff4e26] transition-colors dark:text-zinc-300"
            >
              Privacy
            </Link>
            <a
              href="https://github.com/Wizhill05/resumer-v2"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[var(--fluid-ink)]/70 hover:text-[#ff4e26] transition-colors dark:text-zinc-300"
            >
              <span>GitHub</span>
              <ArrowUpRight size={14} />
            </a>
          </div>
        </div>

        {/* Giant Awwwards-Style Display Typography Statement */}
        <div className="group my-8 sm:my-12 overflow-hidden text-center select-none cursor-pointer">
          <span className="text-[4rem] sm:text-[6rem] lg:text-[8rem] xl:text-[10rem] font-black uppercase tracking-tighter text-black/[0.06] leading-none block transition-all duration-700 ease-out group-hover:text-[#ff4e26] group-hover:scale-105 group-hover:tracking-normal dark:text-white/[0.07]">
            R<span className="normal-case">é</span>sumer
          </span>
        </div>

        {/* Bottom Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-black/10 text-xs font-mono text-[var(--fluid-ink-soft)]/80 dark:border-zinc-800/80 dark:text-zinc-400">
          <span>© {new Date().getFullYear()} RéSUMER. ALL RIGHTS RESERVED.</span>
          <span>BUILT FOR PRECISION</span>
        </div>
      </div>
    </footer>
  )
}
