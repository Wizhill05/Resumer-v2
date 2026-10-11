import { CheckCircle2, ShieldCheck, Layers, Terminal, AlertTriangle } from "lucide-react"

interface AtsPlatform {
  name: string
  category: string
  parseRate: string
  extractionFocus: string
  testedFormats: string
  status: string
}

const ATS_PLATFORMS: AtsPlatform[] = [
  {
    name: "Workday",
    category: "Enterprise Human Capital",
    parseRate: "100% Extraction",
    extractionFocus: "Single-layer linear text stream; zero dropped phone numbers, email headers, or lost text boxes.",
    testedFormats: "Workday v40+ OCR & Parser",
    status: "VERIFIED COMPLIANT",
  },
  {
    name: "Greenhouse",
    category: "High-Growth Tech Standard",
    parseRate: "100% Field Mapping",
    extractionFocus: "Direct taxonomy mapping for Work History, Academic Institutions, and Technical Skills arrays.",
    testedFormats: "Greenhouse Harvest API & Ingest",
    status: "VERIFIED COMPLIANT",
  },
  {
    name: "Lever",
    category: "Modern Talent CRM",
    parseRate: "100% Hierarchy Match",
    extractionFocus: "Strict chronological preservation without multi-column reading order or inverted dates.",
    testedFormats: "Lever Candidate Parser v3",
    status: "VERIFIED COMPLIANT",
  },
  {
    name: "Ashby",
    category: "High-Velocity Hiring Systems",
    parseRate: "100% Semantic Match",
    extractionFocus: "Single-column structural flow with clean Unicode character sets; zero nested tables or canvas bloat.",
    testedFormats: "Ashby ATS Direct Ingestion",
    status: "VERIFIED COMPLIANT",
  },
]

export function AtsCompatibilityMatrix() {
  return (
    <section
      id="ats-matrix"
      aria-label="Enterprise ATS parser compatibility matrix"
      className="relative z-20 border-b border-black/10 bg-white/60 py-20 backdrop-blur-sm dark:border-white/10 dark:bg-zinc-950/60 sm:py-24"
    >
      <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="mx-auto mb-14 max-w-3xl text-center sm:mb-16">
          <span className="mb-4 inline-block border border-black bg-zinc-900 px-3 py-1 font-mono text-xs font-black uppercase tracking-widest text-white shadow-[2px_2px_0px_#ff4e26] dark:border-white dark:bg-white dark:text-black">
            PARSER COMPATIBILITY SUITE
          </span>
          <h2 className="text-3xl font-black uppercase tracking-tight text-zinc-900 dark:text-white sm:text-4xl lg:text-5xl">
            TESTED ON REAL ENTERPRISE PARSERS
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm font-semibold text-zinc-600 dark:text-zinc-400 sm:text-base">
            Most &ldquo;AI resume templates&rdquo; break inside corporate ATS pipelines. Resumer outputs engineered PDF documents designed to parse cleanly on every run.
          </p>
        </div>

        {/* 4 ATS Platforms Grid */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 sm:gap-6 lg:gap-8">
          {ATS_PLATFORMS.map((platform) => (
            <div
              key={platform.name}
              className="flex flex-col justify-between border border-black/15 bg-[#fbfbf3]/80 p-6 shadow-sm transition-all hover:-translate-y-1 hover:border-black/40 hover:shadow-[4px_4px_0px_#000000] dark:border-white/15 dark:bg-zinc-900/60 dark:hover:border-white/30 dark:hover:shadow-[4px_4px_0px_#ff4e26]"
            >
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    {platform.category}
                  </span>
                  <span className="inline-flex items-center gap-1 font-mono text-[10px] font-black text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 size={12} />
                    100%
                  </span>
                </div>

                <h3 className="font-mono text-xl font-black tracking-tight text-zinc-900 dark:text-white">
                  {platform.name}
                </h3>

                <div className="mt-2 inline-block border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                  {platform.parseRate}
                </div>

                <p className="mt-4 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {platform.extractionFocus}
                </p>
              </div>

              <div className="mt-6 border-t border-black/10 pt-3 dark:border-white/10">
                <span className="font-mono text-[10px] font-semibold text-zinc-500 dark:text-zinc-500">
                  Target: {platform.testedFormats}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Deep Technical Architecture Callout */}
        <div className="mt-12 border-2 border-black/20 bg-zinc-50 p-6 shadow-sm dark:border-white/20 dark:bg-zinc-900/40 sm:p-8 lg:mt-16">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-2 flex items-center gap-2">
                <Terminal size={16} className="text-[#ff4e26]" />
                <span className="font-mono text-xs font-black uppercase tracking-wider text-[#ff4e26]">
                  Under The Hood Engine: WeasyPrint PDF/A
                </span>
              </div>
              <h4 className="text-lg font-black uppercase tracking-tight text-zinc-900 dark:text-white sm:text-xl">
                Why Canva and Browser-Print Resumes Get Discarded
              </h4>
              <p className="mt-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400 sm:text-sm">
                Canva and browser &ldquo;Save as PDF&rdquo; tools render text as fragmented coordinate vectors or multi-column canvas blocks. ATS parsers read columns horizontally across lines, scrambling your job titles and dates into gibberish.
                Resumer compiles semantic HTML/CSS using the <strong>WeasyPrint</strong> server engine directly into a standardized single-stream PDF/A document with verified Unicode typography.
              </p>
            </div>

            <div className="flex flex-col gap-2 shrink-0 font-mono text-xs">
              <div className="flex items-center gap-2 border border-red-500/30 bg-red-500/5 px-3 py-2 text-red-700 dark:text-red-300">
                <AlertTriangle size={14} className="shrink-0" />
                <span>Canva / Graphic PDFs: ~42% Parse Failures</span>
              </div>
              <div className="flex items-center gap-2 border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-emerald-700 dark:text-emerald-300">
                <ShieldCheck size={14} className="shrink-0" />
                <span>Resumer WeasyPrint: 100% Parser Extraction</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
