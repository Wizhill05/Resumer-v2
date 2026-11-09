import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { LoginModal } from "@/components/LoginModal"
import { HeroThemeToggle } from "@/components/landing/HeroThemeToggle"

const navLink =
  "text-[var(--fluid-ink)]/80 transition-colors hover:text-[var(--fluid-ink)]"

/** Glass nav, fixed to the top of the landing page. */
export function LandingNav() {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 px-0 md:top-4 md:px-5">
      <div className="pointer-events-auto mx-auto flex h-11 w-full max-w-5xl items-center justify-between border-b border-black/10 bg-white/70 px-4 backdrop-blur-xl md:rounded-md md:border md:border-black/10 md:shadow-[0_18px_50px_-24px_rgba(74,32,4,0.55)] dark:border-white/10 dark:bg-black/60">
        <Link href="/" className="text-base font-black tracking-tight text-[var(--fluid-ink)]">
          R<span className="normal-case">é</span>SUMER
        </Link>
        <div className="flex items-center gap-3 text-xs font-semibold sm:gap-4">
          <Link href="/agent" className={`${navLink} hidden sm:inline`}>
            Agent
          </Link>
          <Link href="/try" className={`${navLink} inline-flex items-center gap-1`}>
            Guest mode
            <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
          <LoginModal triggerClassName={`rounded-none ${navLink}`}>Sign in</LoginModal>
          <div className="h-3.5 w-px bg-[var(--fluid-ink)]/20" aria-hidden="true" />
          <HeroThemeToggle />
        </div>
      </div>
    </header>
  )
}
