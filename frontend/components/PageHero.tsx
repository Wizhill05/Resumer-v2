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
 */
export function PageHero({ title, subtitle, actions, back, narrow, className = "" }: PageHeroProps) {
  return (
    <section
      className={`relative -mt-11 overflow-hidden border-b border-line md:-mt-[60px] ${className}`}
    >
      <FluidField variant="banner" />
      <div
        className={`relative mx-auto w-[min(100%-1.5rem,72rem)] pt-[6.5rem] pb-6 sm:pt-20 sm:pb-8 md:w-[min(100%-3rem,72rem)] md:pt-[6.5rem] md:pb-10 ${
          narrow ? "max-w-4xl" : ""
        }`}
      >
        {back && (
          <Link
            href={back.href}
            className="mb-3 inline-flex px-3 sm:px-0 items-center gap-1.5 text-sm font-semibold text-[var(--fluid-ink-soft)] transition-colors hover:text-[var(--fluid-ink)] dark:text-[#fff2ef]/80 dark:hover:text-[#fff2ef]"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            {back.label}
          </Link>
        )}
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-8">
          <div className="min-w-0 px-3 sm:px-0">
            <h1 className="text-[1.75rem] font-bold leading-[1.05] tracking-[-0.035em] text-[var(--fluid-ink)] sm:text-4xl md:text-[2.75rem]">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-2 max-w-2xl text-sm text-[var(--fluid-ink-soft)] sm:text-base dark:text-[#fff2ef]/80">
                {subtitle}
              </p>
            )}
          </div>
          {actions && <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">{actions}</div>}
        </div>
      </div>
    </section>
  )
}
