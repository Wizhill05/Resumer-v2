export function StoryOverture() {
  return (
    <section className="relative overflow-hidden px-5 py-10 sm:py-24 lg:py-36">
      <div className="landing-reveal relative mx-auto max-w-5xl">
        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-12">
          <div className="text-center lg:col-span-7 lg:text-left">
            <h2 className="text-balance text-2xl font-black leading-[1.14] tracking-tight text-[var(--fluid-ink)] sm:text-4xl md:text-5xl md:leading-[1.1]">
              You&rsquo;re qualified.
              <br />
              <span className="bg-gradient-to-r from-[var(--fluid-deep)] via-[var(--fluid-ember)] to-[var(--fluid-amber)] bg-clip-text font-light text-transparent">
                The screening software
                <br className="hidden sm:inline" />{" "}
                never finds out.
              </span>
            </h2>
          </div>
          <div className="text-center lg:col-span-5 lg:border-l lg:border-black/10 lg:pl-8 lg:text-left dark:lg:border-white/10">
            <p className="mx-auto max-w-md text-sm leading-relaxed text-[var(--fluid-ink-soft)] sm:text-base lg:mx-0">
              Résumer takes what you&rsquo;ve already done and writes it the way
              hiring software reads &mdash; so the right person finally sees it.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

