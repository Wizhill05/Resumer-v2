import { FileText, Cpu, Download } from "lucide-react"

const FEATURES = [
  {
    step: "01",
    title: "Paste Job Target",
    description:
      "Drop in any job description to instantly extract target ATS keywords & skills.",
    icon: FileText,
    badge: "INPUT PIPELINE",
  },
  {
    step: "02",
    title: "Automated Rewrite",
    description:
      "AI rewrites generic responsibilities into high-impact metric bullet points.",
    icon: Cpu,
    badge: "AI MATCH ENGINE",
  },
  {
    step: "03",
    title: "Download ATS PDF",
    description:
      "Export 1-page PDFs formatted specifically to pass Workday, Greenhouse & Lever.",
    icon: Download,
    badge: "1-CLICK EXPORT",
  },
]

export function FeatureGrid() {
  return (
    <section id="flow" className="py-12 sm:py-16 lg:py-20 border-t-2 border-black dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="mb-12 text-center max-w-3xl mx-auto">
          <span className="inline-block border border-black dark:border-zinc-700 bg-[#ff4e26] text-white px-3 py-1 text-xs font-black uppercase tracking-widest mb-3 shadow-[2px_2px_0px_#000000]">
            3-STEP ATS WORKFLOW
          </span>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black uppercase tracking-tight text-zinc-900 dark:text-white leading-none">
            HOW RESUMER GETS YOU INTERVIEWS
          </h2>
          <p className="mt-3 text-base sm:text-lg font-semibold text-zinc-600 dark:text-zinc-400">
            No fluff. Simple, mechanical precision designed for speed and high ATS match rates.
          </p>
        </div>

        {/* 3 Step Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
          {FEATURES.map((feat) => {
            const Icon = feat.icon
            return (
              <div
                key={feat.step}
                className="group relative flex flex-col justify-between border-3 border-black dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6 sm:p-8 shadow-[6px_6px_0px_#000000] dark:shadow-[6px_6px_0px_#3f3f46] transition-all hover:-translate-y-1.5 hover:shadow-[10px_10px_0px_#ff4e26]"
              >
                <div>
                  {/* Step Header */}
                  <div className="flex items-center justify-between border-b-2 border-black dark:border-zinc-800 pb-4 mb-6">
                    <span className="text-4xl sm:text-5xl font-black text-[#ff4e26] tracking-tighter">
                      {feat.step}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 border border-black dark:border-zinc-700">
                      <Icon size={12} className="text-[#ff4e26]" />
                      {feat.badge}
                    </span>
                  </div>

                  {/* Title & Description */}
                  <h3 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 dark:text-white mb-3">
                    {feat.title}
                  </h3>
                  <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 leading-relaxed">
                    {feat.description}
                  </p>
                </div>

                {/* Card Bottom Stripe Accent */}
                <div className="mt-8 pt-4 border-t border-dashed border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs font-mono font-bold text-zinc-400 dark:text-zinc-500">
                  <span>STATUS: READY</span>
                  <span className="group-hover:text-[#ff4e26] transition-colors">
                    EXECUTE →
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
