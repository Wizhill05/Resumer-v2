import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { FluidField } from "@/components/landing/FluidField"
import { LoginModal } from "@/components/LoginModal"
import { CalligraphyTitle } from "@/components/landing/CalligraphyTitle"
import { HeroThemeToggle } from "@/components/landing/HeroThemeToggle"

function ChatGPTMark({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.48 4.48 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-3.494 4.494M3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646M2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.677l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zM8.309 12.863l-2.02-1.159a.08.08 0 0 1-.038-.057V6.074a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.459a.795.795 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  )
}

const subtleButton =
  "group inline-flex items-center justify-center gap-1.5 sm:gap-2 border border-[var(--fluid-ink)]/25 bg-white/40 px-2.5 py-1.5 text-xs font-semibold sm:px-4 sm:py-2 sm:text-sm text-[var(--fluid-ink)] backdrop-blur-sm transition-colors hover:border-[var(--fluid-ink)]/50 hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fluid-ink)] dark:border-white/25 dark:bg-white/5 dark:text-[var(--fluid-ink)] dark:hover:border-white/50 dark:hover:bg-white/10 dark:focus-visible:outline-white"

export function HeroSection() {
  return (
    <section className="relative flex h-[50dvh] min-h-[340px] flex-col justify-between overflow-hidden border-b border-black/10 bg-[var(--fluid-canvas)] md:h-auto md:min-h-[100dvh] dark:border-white/10">
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

      {/* Spacer matching fixed nav height so center area is optically balanced */}
      <div className="h-11 shrink-0" aria-hidden="true" />

      {/* Center: Hero Calligraphy Title centered in the available space */}
      <div className="relative z-10 flex flex-1 items-center justify-center px-4">
        <div className="pointer-events-auto flex w-full max-w-5xl justify-center">
          <CalligraphyTitle className="hero-calligraphy w-full max-w-[17rem] xs:max-w-[21rem] sm:max-w-[34rem] md:max-w-[46rem] lg:max-w-[54rem] xl:max-w-[60rem] 2xl:max-w-[64rem]" />
        </div>
      </div>

      {/* Towards the Bottom: Login/Guest CTA buttons with ChatGPT badge below */}
      <div className="relative z-20 flex flex-col items-center px-4 pb-4 sm:px-5 sm:pb-10 md:pb-14">
        <div className="hero-sub-elements flex flex-col items-center gap-2 sm:gap-4">
          <div className="flex flex-row flex-wrap items-center justify-center gap-2 sm:gap-4">
            <LoginModal
              triggerClassName={subtleButton}
              callbackUrl="/dashboard"
            >
              Login via Google / GitHub
            </LoginModal>
            <Link
              href="/try"
              className={subtleButton}
            >
              <span>Continue as Guest!</span>
              <ArrowUpRight
                size={14}
                className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </Link>
          </div>

          <Link
            href="/connect"
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--fluid-ink-soft)] transition-colors hover:text-[var(--fluid-ink)] sm:text-sm"
          >
            compatible with <ChatGPTMark size={13} /> through the official MCP!
          </Link>
        </div>
      </div>
    </section>
  )
}
