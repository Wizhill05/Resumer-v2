import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
interface FooterProps {
  variant?: "landing" | "simple"
}

export function Footer({ variant = "simple" }: FooterProps) {
  if (variant === "simple") {
    return (
      <footer className="mt-auto border-t border-zinc-800/80 bg-[#121214] text-white min-h-[40vh] sm:min-h-[40dvh] flex flex-col justify-between pt-12 pb-8 px-4 sm:px-6 md:px-8 font-sans">
        <div className="mx-auto max-w-6xl w-full flex-1 flex flex-col justify-between">
          {/* Top row: Brand & Navigation */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 pb-8 border-b border-zinc-800/80">
            <div className="space-y-1">
              <Link
                href="/dashboard"
                className="text-lg font-black tracking-tight text-white hover:opacity-80 transition-opacity"
              >
                R<span className="normal-case">é</span>SUMER
              </Link>
              <p className="text-[11px] font-mono font-medium text-zinc-400 uppercase tracking-wider">
                ATS Résumé Tailoring Engine
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-5 sm:gap-6 text-xs font-mono font-bold uppercase tracking-wider">
              <Link
                href="/connect"
                className="text-zinc-300 hover:text-[#ff4e26] transition-colors"
              >
                ChatGPT
              </Link>
              <Link
                href="/support"
                className="text-zinc-300 hover:text-[#ff4e26] transition-colors"
              >
                Support
              </Link>
              <Link
                href="/privacy"
                className="text-zinc-300 hover:text-[#ff4e26] transition-colors"
              >
                Privacy
              </Link>
              <a
                href="https://github.com/Wizhill05/resumer-v2"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-zinc-300 hover:text-[#ff4e26] transition-colors"
              >
                <span>GitHub</span>
                <ArrowUpRight size={12} />
              </a>
            </div>
          </div>

          {/* Middle: Subtle giant watermark display */}
          <div className="group my-auto py-8 sm:py-10 text-center select-none cursor-pointer overflow-hidden">
            <span className="text-[4rem] sm:text-[6rem] md:text-[7rem] font-black uppercase tracking-tighter text-white/[0.07] leading-none block transition-all duration-700 ease-out group-hover:text-[#ff4e26] group-hover:scale-105">
              R<span className="normal-case">é</span>sumer
            </span>
          </div>

          {/* Bottom Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-6 border-t border-zinc-800/80 text-xs font-mono text-zinc-500">
            <span>© {new Date().getFullYear()} RéSUMER. ALL RIGHTS RESERVED.</span>
            <span>BUILT FOR PRECISION</span>
          </div>
        </div>
      </footer>
    )
  }

  return (
    <footer className="mt-auto border-t border-zinc-800/80 bg-[#121214] text-white min-h-[40vh] sm:min-h-[40dvh] flex flex-col justify-between pt-16 pb-10 px-5 sm:px-6 lg:px-8 font-sans">
      <div className="mx-auto max-w-7xl w-full flex-1 flex flex-col justify-between">
        {/* Main Minimal Link Row */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 pb-10 border-b border-zinc-800/80">
          {/* Left: Brand mark */}
          <div className="space-y-2">
            <Link
              href="/"
              className="text-lg font-black tracking-tight text-white hover:opacity-80 transition-opacity"
            >
              R<span className="normal-case">é</span>SUMER
            </Link>
            <p className="text-xs font-mono font-medium text-zinc-400 uppercase tracking-wider">
              ATS Résumé Tailoring Engine
            </p>
          </div>

          {/* Right: Minimal Navigation */}
          <div className="flex flex-wrap items-center gap-6 sm:gap-8 text-xs font-mono font-bold uppercase tracking-wider">
            <Link
              href="/connect"
              className="text-zinc-300 hover:text-[#ff4e26] transition-colors"
            >
              ChatGPT
            </Link>
            <Link
              href="/try"
              className="inline-flex items-center gap-1 text-zinc-300 hover:text-[#ff4e26] transition-colors"
            >
              <span>Guest Mode</span>
              <ArrowUpRight size={14} />
            </Link>
            <Link
              href="/privacy"
              className="text-zinc-300 hover:text-[#ff4e26] transition-colors"
            >
              Privacy
            </Link>
            <a
              href="https://github.com/Wizhill05/resumer-v2"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-zinc-300 hover:text-[#ff4e26] transition-colors"
            >
              <span>GitHub</span>
              <ArrowUpRight size={14} />
            </a>
          </div>
        </div>

        {/* Giant Awwwards-Style Display Typography Statement */}
        <div className="group my-8 sm:my-12 overflow-hidden text-center select-none cursor-pointer">
          <span className="text-[4rem] sm:text-[6rem] lg:text-[8rem] xl:text-[10rem] font-black uppercase tracking-tighter text-white/[0.07] leading-none block transition-all duration-700 ease-out group-hover:text-[#ff4e26] group-hover:scale-105 group-hover:tracking-normal">
            R<span className="normal-case">é</span>sumer
          </span>
        </div>

        {/* Bottom Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-zinc-800/80 text-xs font-mono text-zinc-400">
          <span>© {new Date().getFullYear()} RéSUMER. ALL RIGHTS RESERVED.</span>
          <span>BUILT FOR PRECISION</span>
        </div>
      </div>
    </footer>
  )
}
