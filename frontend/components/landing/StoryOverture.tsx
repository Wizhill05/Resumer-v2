export function StoryOverture() {
  return (
    <section className="relative overflow-hidden px-5 py-28 sm:py-36">
      <div className="landing-reveal relative mx-auto max-w-2xl text-center">
        <h2 className="text-balance text-2xl font-black leading-[1.14] tracking-tight text-[var(--fluid-ink)] sm:text-4xl md:text-5xl md:leading-[1.1]">
          You&rsquo;re qualified.
          <br />
          <span className="bg-gradient-to-r from-[var(--fluid-deep)] via-[var(--fluid-ember)] to-[var(--fluid-amber)] bg-clip-text font-light text-transparent">
            The screening software
            <br />
            never finds out.
          </span>
        </h2>
        <p className="mx-auto mt-6 max-w-md text-sm leading-relaxed text-[var(--fluid-ink-soft)] sm:text-base">
          Résumer takes what you&rsquo;ve already done and writes it the way
          hiring software reads &mdash; so the right person finally sees it.
        </p>

        {/* Quiet artifact: your résumé, unseen — abstract lines with one struck away */}
        <div className="mx-auto mt-16 w-full max-w-[16rem]" aria-hidden="true">
          <svg viewBox="0 0 240 64" className="w-full text-[var(--fluid-ink)]">
            <rect x="30" y="6" width="180" height="7" rx="3.5" fill="currentColor" opacity="0.14" />
            <rect x="30" y="26" width="150" height="7" rx="3.5" fill="currentColor" opacity="0.14" />
            <rect x="30" y="46" width="90" height="7" rx="3.5" fill="currentColor" opacity="0.14" />
            <path
              d="M22 40 C 80 14, 160 66, 218 30"
              fill="none"
              stroke="var(--fluid-ember)"
              strokeWidth="3"
              strokeLinecap="round"
              opacity="0.85"
            />
          </svg>
        </div>
      </div>
    </section>
  )
}
