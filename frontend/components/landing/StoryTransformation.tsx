export function StoryTransformation() {
  return (
    <section className="relative overflow-hidden px-5 py-28 sm:py-36">
      <div
        className="story-glow left-1/2 top-1/2 h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2"
        aria-hidden="true"
      />
      <div className="landing-reveal relative mx-auto max-w-lg">
        <h2 className="text-balance text-center text-2xl font-black tracking-tight text-[var(--fluid-ink)] sm:text-3xl">
          The same experience, in their words
        </h2>
        <p className="mx-auto mt-4 max-w-sm text-center text-sm leading-relaxed text-[var(--fluid-ink-soft)]">
          A generic bullet becomes a tailored one &mdash; your impact in
          numbers, matching the job&rsquo;s keywords.
        </p>

        {/* The quiet résumé page: weak bullet struck through, tailored one underlined */}
        <div className="relative mx-auto mt-16 max-w-sm border border-black/10 bg-white/70 p-6 shadow-[0_24px_60px_-30px_rgba(74,32,4,0.45)] backdrop-blur-sm dark:border-white/10 dark:bg-black/40 sm:p-8">
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

        <p className="mt-8 text-center text-xs leading-relaxed text-[var(--fluid-ink-soft)]">
          Underlined: the job post&rsquo;s own words, found in your story.
        </p>
      </div>
    </section>
  )
}
