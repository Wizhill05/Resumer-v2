export function StoryTransformation() {
  return (
    <section className="relative overflow-hidden px-5 py-28 sm:py-36">
      <div className="landing-reveal relative mx-auto max-w-lg">
        <h2 className="text-balance text-center text-2xl font-black tracking-tight text-[var(--fluid-ink)] sm:text-3xl">
          The same experience, in their words
        </h2>
        <p className="mx-auto mt-4 max-w-sm text-center text-sm leading-relaxed text-[var(--fluid-ink-soft)]">
          A generic bullet becomes a tailored one &mdash; your impact in
          numbers, matching the job&rsquo;s keywords.
        </p>

        {/* The quiet résumé page on a gradient frame: weak bullet struck through, tailored one underlined */}
        <div className="relative mx-auto mt-16 max-w-sm bg-gradient-to-b from-[var(--fluid-ember)]/60 via-black/10 to-transparent p-px shadow-[0_24px_60px_-30px_rgba(74,32,4,0.45)] dark:via-white/10">
          <div className="bg-white px-6 py-6 dark:bg-[#202024] sm:px-8 sm:py-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--fluid-ink-soft)]">
              Experience
            </p>
            <div className="mt-5 space-y-5">
              <p className="text-sm leading-relaxed text-[var(--fluid-ink-soft)] line-through decoration-1 decoration-[var(--fluid-ink-soft)]/50">
                Responsible for writing backend services and maintaining
                databases for the platform team.
              </p>
              <div
                className="border-t border-black/10 dark:border-white/10"
                aria-hidden="true"
              />
              <p className="text-sm leading-relaxed text-[var(--fluid-ink)]">
                Architected{" "}
                <span className="underline decoration-[var(--fluid-ember)] decoration-2 underline-offset-4">
                  FastAPI microservices
                </span>{" "}
                processing{" "}
                <span className="underline decoration-[var(--fluid-ember)] decoration-2 underline-offset-4">
                  45K req/s
                </span>
                , cutting{" "}
                <span className="underline decoration-[var(--fluid-ember)] decoration-2 underline-offset-4">
                  p99 latency by 38%
                </span>{" "}
                with Redis caching.
              </p>
            </div>
          </div>
        </div>

        <p className="mt-8 text-center text-xs leading-relaxed text-[var(--fluid-ink-soft)]">
          Underlined: the job post&rsquo;s own words, found in your story.
        </p>
      </div>
    </section>
  )
}
