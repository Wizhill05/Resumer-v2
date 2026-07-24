import Link from "next/link"
import { FooterThemeToggle } from "@/components/FooterThemeToggle"
import { ArrowUpRight } from "lucide-react"

interface FooterProps {
  variant?: "landing" | "simple"
}

export function Footer({ variant = "simple" }: FooterProps) {
  if (variant === "simple") {
    return (
      <footer className="mt-auto border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white py-5 px-4 sm:px-6 lg:px-8 font-sans">
        <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* Left: Logo & copyright */}
          <div className="flex items-center gap-3">
            <div className="resumer-mark px-2.5 py-0.5 text-xs font-black">
              <span className="text-sm font-extrabold uppercase tracking-tight text-zinc-900 dark:text-zinc-100">
                RESUMER
              </span>
            </div>
            <span className="text-xs font-mono font-semibold text-zinc-500 dark:text-zinc-400">
              © {new Date().getFullYear()} Resumer
            </span>
          </div>

          {/* Right: Links & Theme Toggle */}
          <div className="flex items-center gap-5 text-xs font-mono font-bold text-zinc-600 dark:text-zinc-400">
            <Link
              href="/support"
              className="hover:text-zinc-900 dark:hover:text-white transition-colors"
            >
              Support
            </Link>
            <Link
              href="/privacy"
              className="hover:text-zinc-900 dark:hover:text-white transition-colors"
            >
              Privacy
            </Link>
            <a
              href="https://github.com/Wizhill05/resumer-v2"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-white transition-colors"
            >
              <span>GitHub</span>
              <ArrowUpRight size={12} />
            </a>
            <FooterThemeToggle />
          </div>
        </div>
      </footer>
    )
  }

  return (
    <footer className="mt-auto border-t-2 border-black dark:border-zinc-800 bg-[#fbfbf3] dark:bg-zinc-950 text-zinc-900 dark:text-white pt-16 pb-10 px-4 sm:px-6 lg:px-8 font-sans transition-colors">
      <div className="mx-auto max-w-7xl">
        {/* Main Minimal Link Row */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 pb-12 border-b border-zinc-300 dark:border-zinc-800">
          {/* Left: Brand mark */}
          <div className="space-y-2">
            <div className="resumer-mark px-3 py-1 text-sm font-black inline-flex">
              <span className="text-base font-extrabold uppercase tracking-tight text-zinc-900 dark:text-zinc-100">
                RESUMER
              </span>
            </div>
            <p className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
              ATS Resume Tailoring Engine
            </p>
          </div>

          {/* Right: Minimal Navigation */}
          <div className="flex flex-wrap items-center gap-6 sm:gap-8 text-xs font-mono font-black uppercase">
            <Link
              href="/try"
              className="inline-flex items-center gap-1 text-zinc-900 dark:text-zinc-200 hover:text-[#ff4e26] dark:hover:text-[#ff4e26] transition-colors"
            >
              <span>Guest Mode</span>
              <ArrowUpRight size={14} />
            </Link>
            <Link
              href="/privacy"
              className="text-zinc-900 dark:text-zinc-200 hover:text-[#ff4e26] dark:hover:text-[#ff4e26] transition-colors"
            >
              Privacy
            </Link>
            <a
              href="https://github.com/Wizhill05/resumer-v2"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-zinc-900 dark:text-zinc-200 hover:text-[#ff4e26] dark:hover:text-[#ff4e26] transition-colors"
            >
              <span>GitHub</span>
              <ArrowUpRight size={14} />
            </a>
          </div>
        </div>

        {/* Giant Awwwards-Style Display Typography Statement */}
        <div className="group my-10 sm:my-14 overflow-hidden text-center select-none cursor-pointer">
          <span className="text-[15vw] sm:text-[16vw] font-black uppercase tracking-tighter text-zinc-900/10 dark:text-white/10 leading-none block transition-all duration-700 ease-out group-hover:text-[#ff4e26] group-hover:scale-105 group-hover:tracking-normal">
            RESUMER
          </span>
        </div>

        {/* Bottom Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-zinc-300 dark:border-zinc-800 text-xs font-mono text-zinc-500 dark:text-zinc-400">
          <span>© {new Date().getFullYear()} RESUMER. ALL RIGHTS RESERVED.</span>
          <div>
            <FooterThemeToggle />
          </div>
        </div>
      </div>
    </footer>
  )
}
