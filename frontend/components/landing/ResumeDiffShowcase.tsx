"use client"

import { useState } from "react"
import { XCircle, CheckCircle2, Sparkles, Tag, ArrowRight } from "lucide-react"

interface PersonaDiff {
  id: string
  roleTitle: string
  targetJob: string
  beforeScore: number
  afterScore: number
  beforeStatus: string
  afterStatus: string
  beforeBullet: string
  beforeIssues: string[]
  afterBullet: string
  afterHighlights: { text: string; isMetric?: boolean; isKeyword?: boolean }[]
  matchedKeywords: string[]
}

const PERSONAS: PersonaDiff[] = [
  {
    id: "software-engineer",
    roleTitle: "Software Engineer",
    targetJob: "Target: Senior Systems / Backend Engineer",
    beforeScore: 34,
    afterScore: 98,
    beforeStatus: "Filtered by ATS",
    afterStatus: "Top 5% Candidate",
    beforeBullet:
      "Responsible for managing team tasks, attending daily standups, and writing backend code in Python and maintaining database queries for our users.",
    beforeIssues: ["Zero Quantified Impact", "Passive Voice ('Responsible for')", "Missing Target Keywords"],
    afterBullet:
      "Architected asynchronous FastAPI microservices processing 45K req/s, slashing p99 database latency by 38% via Redis caching and optimized PostgreSQL pooling.",
    afterHighlights: [
      { text: "Architected asynchronous ", isKeyword: false },
      { text: "FastAPI microservices", isKeyword: true },
      { text: " processing ", isKeyword: false },
      { text: "45K req/s", isMetric: true },
      { text: ", slashing ", isKeyword: false },
      { text: "p99 database latency by 38%", isMetric: true },
      { text: " via ", isKeyword: false },
      { text: "Redis caching", isKeyword: true },
      { text: " and optimized ", isKeyword: false },
      { text: "PostgreSQL pooling", isKeyword: true },
      { text: ".", isKeyword: false },
    ],
    matchedKeywords: ["FastAPI", "p99 Latency", "Microservices", "PostgreSQL", "Redis Caching"],
  },
  {
    id: "product-manager",
    roleTitle: "Product Manager",
    targetJob: "Target: Lead Growth / Platform Product Manager",
    beforeScore: 29,
    afterScore: 96,
    beforeStatus: "Filtered by ATS",
    afterStatus: "Top 5% Candidate",
    beforeBullet:
      "Helped team ship new features for the web app, listened to customer feedback, and worked with engineers and designers on quarterly roadmap ideas.",
    beforeIssues: ["No Revenue/Conversion Metrics", "Generic Scope ('Helped team')", "Lack of Product Frameworks"],
    afterBullet:
      "Spearheaded activation funnel redesign driving +24% onboarding conversion ($1.8M ARR impact) by analyzing user telemetry and running 14 A/B experiments.",
    afterHighlights: [
      { text: "Spearheaded ", isKeyword: false },
      { text: "activation funnel redesign", isKeyword: true },
      { text: " driving ", isKeyword: false },
      { text: "+24% onboarding conversion", isMetric: true },
      { text: " (", isKeyword: false },
      { text: "$1.8M ARR impact", isMetric: true },
      { text: ") by analyzing ", isKeyword: false },
      { text: "user telemetry", isKeyword: true },
      { text: " and running ", isKeyword: false },
      { text: "14 A/B experiments", isKeyword: true },
      { text: ".", isKeyword: false },
    ],
    matchedKeywords: ["Funnel Optimization", "ARR Impact", "A/B Testing", "User Telemetry", "Retention"],
  },
  {
    id: "devops",
    roleTitle: "DevOps & Cloud",
    targetJob: "Target: Staff SRE / Platform Engineer",
    beforeScore: 31,
    afterScore: 97,
    beforeStatus: "Filtered by ATS",
    afterStatus: "Top 5% Candidate",
    beforeBullet:
      "Maintained cloud servers on AWS, responded to outage alerts when systems went down, and helped engineers deploy their code to testing environments.",
    beforeIssues: ["Reactive Language ('Maintained')", "Zero SLA / Uptime Metrics", "No Infrastructure-as-Code Terms"],
    afterBullet:
      "Automated multi-region Kubernetes CI/CD pipelines via Terraform and GitHub Actions, reducing deployment failure rate from 14% to 0.4% and cutting MTTR by 62%.",
    afterHighlights: [
      { text: "Automated multi-region ", isKeyword: false },
      { text: "Kubernetes CI/CD pipelines", isKeyword: true },
      { text: " via ", isKeyword: false },
      { text: "Terraform & GitHub Actions", isKeyword: true },
      { text: ", reducing deployment failure rate from ", isKeyword: false },
      { text: "14% to 0.4%", isMetric: true },
      { text: " and cutting ", isKeyword: false },
      { text: "MTTR by 62%", isMetric: true },
      { text: ".", isKeyword: false },
    ],
    matchedKeywords: ["Kubernetes", "CI/CD", "Terraform", "MTTR Reduction", "Infrastructure as Code"],
  },
]

export function ResumeDiffShowcase() {
  const [activePersonaId, setActivePersonaId] = useState(PERSONAS[0].id)
  const activePersona = PERSONAS.find((p) => p.id === activePersonaId) || PERSONAS[0]

  return (
    <section
      id="diff-showcase"
      aria-label="Before and after resume bullet comparison"
      className="relative z-20 border-b border-black/10 bg-[#fbfbf3]/30 py-20 dark:border-white/10 dark:bg-black/30 sm:py-24"
    >
      <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mx-auto mb-12 max-w-3xl text-center sm:mb-16">
          <span className="mb-4 inline-block border border-black bg-[#ff4e26] px-3 py-1 font-mono text-xs font-black uppercase tracking-widest text-white shadow-[2px_2px_0px_#000000] dark:border-zinc-700">
            SIDE-BY-SIDE ATS AUDIT
          </span>
          <h2 className="text-3xl font-black uppercase tracking-tight text-zinc-900 dark:text-white sm:text-4xl lg:text-5xl">
            HOW AI TRANSFORMS WEAK BULLETS
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm font-semibold text-zinc-600 dark:text-zinc-400 sm:text-base">
            ATS filters score resumes on metric density and keyword match. Watch generic responsibilities turn into high-conversion interview triggers.
          </p>

          {/* Persona Tab Switcher */}
          <div
            role="tablist"
            aria-label="Select role persona"
            className="mt-8 inline-flex flex-wrap items-center justify-center gap-2 border border-black/15 bg-white/80 p-1.5 shadow-sm dark:border-white/15 dark:bg-zinc-900/80"
          >
            {PERSONAS.map((persona) => {
              const isActive = persona.id === activePersonaId
              return (
                <button
                  key={persona.id}
                  role="tab"
                  id={`tab-${persona.id}`}
                  aria-selected={isActive}
                  aria-controls={`panel-${persona.id}`}
                  onClick={() => setActivePersonaId(persona.id)}
                  className={`px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                    isActive
                      ? "border border-black bg-zinc-900 text-white shadow-[2px_2px_0px_#ff4e26] dark:border-white dark:bg-white dark:text-black dark:shadow-[2px_2px_0px_#ff4e26]"
                      : "text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-white"
                  }`}
                >
                  {persona.roleTitle}
                </button>
              )
            })}
          </div>
        </div>

        {/* Diff Display Container */}
        <div
          id={`panel-${activePersona.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${activePersona.id}`}
          className="mx-auto max-w-5xl"
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-black/10 pb-3 dark:border-white/10">
            <span className="font-mono text-xs font-semibold text-zinc-600 dark:text-zinc-400">
              {activePersona.targetJob}
            </span>
            <div className="flex items-center gap-3 font-mono text-xs font-bold">
              <span className="text-red-600 dark:text-red-400">Before: {activePersona.beforeScore}%</span>
              <ArrowRight size={13} className="text-zinc-400" />
              <span className="text-emerald-600 dark:text-emerald-400">After: {activePersona.afterScore}%</span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Left: BEFORE Box */}
            <div className="relative flex flex-col justify-between border-2 border-red-500/30 bg-red-500/5 p-6 shadow-sm dark:border-red-500/20 dark:bg-red-950/10">
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs font-black uppercase tracking-wider text-red-600 dark:text-red-400">
                    <XCircle size={14} />
                    Untailored Bullet
                  </span>
                  <span className="border border-red-500/40 bg-red-100 px-2 py-0.5 font-mono text-[10px] font-bold text-red-700 dark:bg-red-900/40 dark:text-red-300">
                    {activePersona.beforeStatus} ({activePersona.beforeScore}%)
                  </span>
                </div>

                <blockquote className="text-sm font-medium leading-relaxed text-zinc-800 dark:text-zinc-300">
                  &ldquo;{activePersona.beforeBullet}&rdquo;
                </blockquote>
              </div>

              <div className="mt-6 border-t border-red-500/20 pt-4">
                <span className="block font-mono text-[10px] font-bold uppercase tracking-wider text-red-700/80 dark:text-red-400/80">
                  ATS Flaws Detected:
                </span>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {activePersona.beforeIssues.map((issue) => (
                    <li
                      key={issue}
                      className="border border-red-400/30 bg-red-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-red-700 dark:text-red-300"
                    >
                      ✕ {issue}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Right: AFTER Box */}
            <div className="relative flex flex-col justify-between border-2 border-emerald-500/40 bg-emerald-500/5 p-6 shadow-[4px_4px_0px_rgba(16,185,129,0.2)] dark:border-emerald-500/30 dark:bg-emerald-950/15">
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 size={14} />
                    Resumer AI Tailored
                  </span>
                  <span className="border border-emerald-500/40 bg-emerald-100 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                    {activePersona.afterStatus} ({activePersona.afterScore}%) — 98% Peak Match
                  </span>
                </div>

                <div className="text-sm font-medium leading-relaxed text-zinc-900 dark:text-zinc-100">
                  &ldquo;
                  {activePersona.afterHighlights.map((part, idx) => {
                    if (part.isMetric) {
                      return (
                        <span
                          key={idx}
                          className="bg-emerald-500/20 px-1 py-0.5 font-bold text-emerald-800 dark:bg-emerald-400/20 dark:text-emerald-300"
                        >
                          {part.text}
                        </span>
                      )
                    }
                    if (part.isKeyword) {
                      return (
                        <span
                          key={idx}
                          className="bg-amber-500/20 px-1 py-0.5 font-bold text-amber-900 dark:bg-amber-400/20 dark:text-amber-200"
                        >
                          {part.text}
                        </span>
                      )
                    }
                    return <span key={idx}>{part.text}</span>
                  })}
                  &rdquo;
                </div>
              </div>

              <div className="mt-6 border-t border-emerald-500/20 pt-4">
                <span className="flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-700/80 dark:text-emerald-400/80">
                  <Tag size={10} />
                  ATS Keywords Matched:
                </span>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {activePersona.matchedKeywords.map((kw) => (
                    <span
                      key={kw}
                      className="border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-700 dark:text-emerald-300"
                    >
                      ✓ {kw}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
