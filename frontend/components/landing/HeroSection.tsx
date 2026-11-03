import { AgentMarks } from "@/components/landing/AgentMarks"
import Link from "next/link"
import { ArrowDown, ArrowUpRight, Star } from "lucide-react"
import { FluidField } from "@/components/landing/FluidField"
import { LoginModal } from "@/components/LoginModal"
import { CalligraphyTitle } from "@/components/landing/CalligraphyTitle"
import { HeroThemeToggle } from "@/components/landing/HeroThemeToggle"

const subtleButton =
  "group inline-flex items-center justify-center gap-1.5 sm:gap-2 border border-[var(--fluid-ink)]/25 bg-white/40 px-2.5 py-1.5 text-xs font-semibold sm:px-4 sm:py-2 sm:text-sm text-[var(--fluid-ink)] backdrop-blur-sm transition-colors hover:border-[var(--fluid-ink)]/50 hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fluid-ink)] dark:border-white/25 dark:bg-white/5 dark:text-[var(--fluid-ink)] dark:hover:border-white/50 dark:hover:bg-white/10 dark:focus-visible:outline-white"

const heroAction =
  "group inline-flex items-center justify-center gap-1.5 px-1 py-1.5 text-xs font-semibold text-[var(--fluid-ink-soft)] underline underline-offset-4 dark:text-[#fff2ef]/90 sm:text-[var(--fluid-ink)] sm:dark:text-[var(--fluid-ink)] transition-colors hover:text-[var(--fluid-ink-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fluid-ink)] sm:gap-2 sm:border sm:border-[var(--fluid-ink)]/25 sm:bg-white/40 sm:px-4 sm:py-2 sm:text-sm sm:no-underline sm:backdrop-blur-sm sm:hover:border-[var(--fluid-ink)]/50 sm:hover:bg-white/70 dark:focus-visible:outline-white sm:dark:border-white/25 sm:dark:bg-white/5 sm:dark:hover:border-white/50 sm:dark:hover:bg-white/10"

export function HeroSection() {
  return (
    <section className="relative flex h-[50dvh] min-h-[300px] flex-col overflow-hidden border-b border-black/10 bg-[var(--fluid-canvas)] md:h-auto md:min-h-[100dvh] dark:border-white/10">
      <FluidField />

      {/* Glass nav — fixed to the top always even when scrolling */}
      <header className="fixed top-0 inset-x-0 z-50 px-0 md:top-4 md:px-5 pointer-events-none">
        <div className="pointer-events-auto mx-auto flex h-11 w-full max-w-5xl items-center justify-between border-b border-black/10 bg-white/70 px-4 backdrop-blur-xl md:border md:border-black/10 md:shadow-[0_18px_50px_-24px_rgba(74,32,4,0.55)] dark:border-white/10 dark:bg-black/60 md:dark:bg-black/60">
          <Link
            href="/"
            className="text-base font-black tracking-tight text-[var(--fluid-ink)]"
          >
            R<span className="normal-case">é</span>SUMER
          </Link>
          <div className="flex items-center gap-3 text-xs font-semibold sm:gap-4">
            <LoginModal
              triggerClassName="rounded-none text-[var(--fluid-ink)]/80 transition-colors hover:text-[var(--fluid-ink)]"
            >
              Sign in
            </LoginModal>
            <Link
              href="/try"
              className="inline-flex items-center gap-1 text-[var(--fluid-ink)]/80 transition-colors hover:text-[var(--fluid-ink)]"
            >
              Guest Mode
              <ArrowUpRight size={13} />
            </Link>
            <div className="h-3.5 w-px bg-[var(--fluid-ink)]/20" aria-hidden="true" />
            <HeroThemeToggle />
          </div>
        </div>
      </header>

      {/* Pure Center: Hero Calligraphy Title centered in the screen */}
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4 pb-2 sm:px-5 sm:pb-0">
        <div className="pointer-events-auto flex w-full max-w-5xl justify-center">
          <CalligraphyTitle className="hero-calligraphy w-full max-w-[18rem] xs:max-w-[22rem] sm:max-w-[34rem] md:max-w-[46rem] lg:max-w-[54rem] xl:max-w-[60rem] 2xl:max-w-[64rem]" />
        </div>
      </div>

      {/* Login and guest actions with agent compatibility link */}
      <div className="relative z-20 mt-auto flex flex-col items-center justify-end px-4 pb-6 sm:px-5 sm:pb-10 md:pb-14">
        <div className="hero-sub-elements flex flex-col items-center gap-4 sm:gap-6">
          <div className="flex flex-row flex-wrap items-center justify-center gap-2 sm:gap-4">
            <LoginModal
              triggerClassName={heroAction}
              callbackUrl="/dashboard"
            >
              Login via Google / GitHub
            </LoginModal>
            <Link
              href="/try"
              className={heroAction}
            >
              <span>Continue as Guest!</span>
              <ArrowUpRight
                size={14}
                className="hidden transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 sm:block"
              />
            </Link>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <Link
              href="/agent"
              className="inline-flex items-center gap-2 text-[11px] font-medium text-[var(--fluid-ink-soft)] dark:text-[#fff2ef]/90 transition-colors hover:text-[var(--fluid-ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--fluid-ink)] sm:text-sm"
            >
              <span>Connect your agent</span>
              <span aria-hidden="true" className="translate-y-[3px]"><AgentMarks /></span>
            </Link>
          </div>
        </div>
      </div>

      <div className="relative z-20 hidden w-full items-center justify-between gap-3 px-5 pb-5 sm:flex">
        <a href="#how-it-works" className={subtleButton}>
          <ArrowDown size={14} aria-hidden="true" />
          <span>How it works</span>
        </a>
        <a
          href="https://github.com/Wizhill05/resumer-v2"
          target="_blank"
          rel="noopener noreferrer"
          className={subtleButton}
        >
          <Star size={14} aria-hidden="true" />
          <span>Star on GitHub</span>
        </a>
      </div>
    </section>
  )
}
