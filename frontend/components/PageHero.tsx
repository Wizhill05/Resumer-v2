import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { FluidField } from "@/components/landing/FluidField"

interface PageHeroProps {
  title: ReactNode
  subtitle?: ReactNode
  /** Buttons or status shown on the right on desktop, below the title on mobile. */
  actions?: ReactNode
  back?: { href: string; label: string }
  /** Narrower content column, for focused single-column pages. */
  narrow?: boolean
  className?: string
}

/**
 * Fluid gradient page header that sits under the sticky glass <Nav />.
 * The negative top margin pulls the banner up behind the nav so the
 * gradient reaches the top of the viewport, like the dashboard and /agent.
 *
 * Phones get a centered layout, like the homepage and /agent heroes: wider
 * side margins, balanced line breaks (no one-word orphan lines), and a fixed
 * vertical rhythm (back 12px, title 10px, subtitle 24px, actions). The
 * `.page-hero-actions` rules in globals.css turn the buttons into quiet glass
 * buttons so they don't compete with the title. Desktop is left/right aligned.
 */
export function PageHero({ title, subtitle, actions, back, narrow, className = "" }: PageHeroProps) {
  return (
    <section
      className={`relative -mt-11 overflow-hidden border-b border-line md:-mt-[60px] ${className}`}
    >
      <FluidField variant="banner" />
      <div
        className={`relative mx-auto w-[min(100%-2.5rem,72rem)] pt-[5.5rem] min-[375px]:w-[min(100%-3.5rem,72rem)] pb-9 text-center sm:w-[min(100%-5rem,72rem)] md:w-[min(100%-3rem,72rem)] md:pt-[6.5rem] md:pb-10 md:text-left ${
          narrow ? "max-w-4xl" : ""
        }`}
      >
        {back && (
          <Link
            href={back.href}
            className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--fluid-ink-soft)] transition-colors hover:text-[var(--fluid-ink)] dark:text-[#fff2ef]/80 dark:hover:text-[#fff2ef]"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            {back.label}
          </Link>
        )}
        <div className="flex flex-col items-center gap-6 md:flex-row md:items-end md:justify-between md:gap-8">
          <div className="w-full min-w-0 md:w-auto">
            <h1 className="text-balance text-[1.875rem] font-bold leading-[1.08] tracking-[-0.035em] text-[var(--fluid-ink)] sm:text-4xl md:text-wrap md:text-[2.75rem] md:leading-[1.05]">
              {title}
            </h1>
            {subtitle && (
              <p className="mx-auto mt-2.5 max-w-[21rem] text-balance text-sm leading-relaxed text-[var(--fluid-ink-soft)] sm:max-w-md sm:text-base md:mx-0 md:mt-2 md:max-w-2xl md:text-wrap md:leading-normal dark:text-[#fff2ef]/80">
                {subtitle}
              </p>
            )}
          </div>
          {actions && (
            <div className="page-hero-actions flex shrink-0 flex-col items-center gap-3 md:items-end md:gap-2">{actions}</div>
          )}
        </div>
      </div>
    </section>
  )
}
