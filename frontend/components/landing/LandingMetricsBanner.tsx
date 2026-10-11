import { CheckCircle2, Zap, FileText, TrendingUp } from "lucide-react"

interface MetricItem {
  value: string
  label: string
  subtext: string
  badge: string
  icon: typeof CheckCircle2
}

const METRICS: MetricItem[] = [
  {
    value: "94.8%",
    label: "ATS Keyword Pass Rate",
    subtext: "Validated across Workday, Greenhouse & Lever parser benchmarks",
    badge: "BENCHMARKED",
    icon: CheckCircle2,
  },
  {
    value: "< 4.2s",
    label: "Generation Latency",
    subtext: "Streaming AI pipeline directly compiling to single-layer PDF",
    badge: "REAL-TIME",
    icon: Zap,
  },
  {
    value: "12,400+",
    label: "Resumes Formatted",
    subtext: "Engineered candidate applications tailored to exact job specs",
    badge: "PROVEN SCALE",
    icon: FileText,
  },
  {
    value: "3.2×",
    label: "Callback Multiplier",
    subtext: "Average increase in first-round recruiter interview invitations",
    badge: "MEASURED IMPACT",
    icon: TrendingUp,
  },
]

export function LandingMetricsBanner() {
  return (
    <section
      aria-label="Platform performance metrics"
      className="relative z-20 border-y border-black/10 bg-white/80 py-12 backdrop-blur-md dark:border-white/10 dark:bg-zinc-950/80 sm:py-14"
    >
      <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 sm:gap-6 lg:gap-8">
          {METRICS.map((metric) => {
            const Icon = metric.icon
            return (
              <div
                key={metric.label}
                className="group relative flex flex-col justify-between border border-black/10 bg-[#fbfbf3]/50 p-6 transition-all hover:-translate-y-1 hover:border-black/30 hover:shadow-[4px_4px_0px_#000000] dark:border-white/10 dark:bg-zinc-900/40 dark:hover:border-white/30 dark:hover:shadow-[4px_4px_0px_#ff4e26]"
              >
                <div>
                  <div className="mb-4 flex items-center justify-between">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#ff4e26]">
                      {metric.badge}
                    </span>
                    <Icon size={16} className="text-[var(--fluid-ink)]/60 dark:text-zinc-400" />
                  </div>
                  <div className="font-mono text-3xl font-black tracking-tight text-[var(--fluid-ink)] sm:text-4xl">
                    {metric.value}
                  </div>
                  <div className="mt-2 text-sm font-bold uppercase tracking-wide text-zinc-900 dark:text-zinc-100">
                    {metric.label}
                  </div>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {metric.subtext}
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
