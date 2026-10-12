import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { LoginModal } from "@/components/LoginModal"

const subtleButton =
  "group inline-flex items-center justify-center gap-2 border border-[var(--fluid-ink)]/25 bg-white/40 px-4 py-2 text-sm font-semibold text-[var(--fluid-ink)] backdrop-blur-sm transition-colors hover:border-[var(--fluid-ink)]/50 hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fluid-ink)] dark:border-white/25 dark:bg-white/5 dark:text-[var(--fluid-ink)] dark:hover:border-white/50 dark:hover:bg-white/10 dark:focus-visible:outline-white"

export function StoryClosing() {
  return (
    <section className="relative overflow-hidden px-5 pb-32 pt-28 sm:pb-40 sm:pt-36">
      <div className="landing-reveal relative mx-auto max-w-xl text-center">
        <h2 className="text-balance text-3xl font-black leading-[1.12] tracking-tight text-[var(--fluid-ink)] sm:text-4xl">
          Private by design
        </h2>
        <p className="mx-auto mt-5 max-w-md text-sm leading-relaxed text-[var(--fluid-ink-soft)] sm:text-base">
          Nothing is stored. Nothing is used to train anything. You leave with
          one ATS-safe PDF &mdash; that&rsquo;s the whole deal.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
          <LoginModal
            triggerClassName={subtleButton}
            callbackUrl="/dashboard"
          >
            Login via Google / GitHub
          </LoginModal>
          <Link href="/try" className={subtleButton}>
            <span>Continue as Guest!</span>
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
