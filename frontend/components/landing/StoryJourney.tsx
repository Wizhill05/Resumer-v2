import { FileText, Sparkles, Download } from "lucide-react"

const STEPS = [
  {
    n: "01",
    icon: FileText,
    title: "Bring what you have",
    body: "Paste your background once, then add the job you actually want.",
  },
  {
    n: "02",
    icon: Sparkles,
    title: "Watch it become relevant",
    body: "Your experience is rewritten in the job\u2019s own language \u2014 metrics, keywords, structure.",
  },
  {
    n: "03",
    icon: Download,
    title: "Send it out",
    body: "One clean PDF that every applicant tracking system reads correctly.",
  },
]

export function StoryJourney() {
  return (
    <section className="relative overflow-hidden px-5 py-28 sm:py-36">
      <div
        className="story-glow bottom-0 right-[-18%] h-[40rem] w-[40rem] translate-y-1/2"
        aria-hidden="true"
      />
      <div className="landing-reveal relative mx-auto max-w-xl">
        <h2 className="text-center text-2xl font-black tracking-tight text-[var(--fluid-ink)] sm:text-3xl">
          Three steps, no busywork
        </h2>
        <p className="mx-auto mt-4 max-w-sm text-center text-sm leading-relaxed text-[var(--fluid-ink-soft)]">
          From what you&rsquo;ve done to what they asked for.
        </p>

        <ol className="mt-16 space-y-14 sm:mt-20 sm:space-y-16">
          {STEPS.map((step) => {
            const Icon = step.icon
            return (
              <li key={step.n} className="flex gap-6 sm:gap-10">
                <span
                  aria-hidden="true"
                  className="w-12 shrink-0 text-right font-light text-4xl leading-none text-[var(--fluid-ink)]/35 sm:w-16 sm:text-5xl"
                >
                  {step.n}
                </span>
                <div className="border-l border-black/10 pl-6 dark:border-white/10 sm:pl-10">
                  <div className="flex items-center gap-3">
                    <Icon
                      size={17}
                      strokeWidth={1.5}
                      className="text-[var(--fluid-ink-soft)]"
                      aria-hidden="true"
                    />
                    <h3 className="text-lg font-bold tracking-tight text-[var(--fluid-ink)] sm:text-xl">
                      {step.title}
                    </h3>
                  </div>
                  <p className="mt-2 max-w-sm text-sm leading-relaxed text-[var(--fluid-ink-soft)]">
                    {step.body}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}
