import { ShieldCheck, EyeOff, Lock, Trash2, KeyRound } from "lucide-react"

interface SecurityGuarantee {
  title: string
  badge: string
  description: string
  icon: typeof ShieldCheck
  highlight: string
}

const GUARANTEES: SecurityGuarantee[] = [
  {
    title: "Zero Model Training",
    badge: "AIR-GAPPED PRIVACY",
    description:
      "Your career history, previous companies, and target job postings are strictly transient. We explicitly opt out of foundation model training across all LLM inference pipelines.",
    highlight: "Never shared with AI training datasets",
    icon: EyeOff,
  },
  {
    title: "Cloudflare R2 Storage (AES-256)",
    badge: "ENCRYPTED AT REST",
    description:
      "Generated resume PDFs are encrypted at rest with AES-256 server-side encryption and accessed via ephemeral signed URLs hosted on Cloudflare R2 object storage.",
    highlight: "Encrypted at rest & in transit",
    icon: Lock,
  },
  {
    title: "1-Click Full Data Purge",
    badge: "DATA DIGNITY",
    description:
      "You have absolute ownership over your career data. Delete your account, generated resumes, and saved job targets permanently at any time with a single click.",
    highlight: "Immediate permanent erasure",
    icon: Trash2,
  },
  {
    title: "Passwordless OAuth Security",
    badge: "ZERO PASSWORD STORAGE",
    description:
      "Authenticate seamlessly using Google or GitHub OAuth. We never store or handle raw passwords, eliminating credential leak risks and password reuse vulnerabilities.",
    highlight: "Hardened identity verification",
    icon: KeyRound,
  },
]

export function SecuritySection() {
  return (
    <section
      id="security"
      aria-label="Privacy and security guarantees"
      className="relative z-20 border-b border-black/10 bg-[#fbfbf3]/50 py-20 dark:border-white/10 dark:bg-black/40 sm:py-24"
    >
      <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="mx-auto mb-14 max-w-3xl text-center sm:mb-16">
          <span className="mb-4 inline-block border border-black bg-zinc-900 px-3 py-1 font-mono text-xs font-black uppercase tracking-widest text-white shadow-[2px_2px_0px_#ff4e26] dark:border-white dark:bg-white dark:text-black">
            DATA DIGNITY &amp; TRUST
          </span>
          <h2 className="text-3xl font-black uppercase tracking-tight text-zinc-900 dark:text-white sm:text-4xl lg:text-5xl">
            YOUR CAREER DATA STAYS PRIVATE
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm font-semibold text-zinc-600 dark:text-zinc-400 sm:text-base">
            We build tools for serious candidates. We do not monetize your resume, sell candidate profiles, or train public AI models on your work.
          </p>
        </div>

        {/* 4 Guarantees Grid */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 sm:gap-6 lg:gap-8">
          {GUARANTEES.map((item) => {
            const Icon = item.icon
            return (
              <div
                key={item.title}
                className="group flex flex-col justify-between border border-black/15 bg-white/90 p-6 shadow-sm transition-all hover:-translate-y-1 hover:border-black/40 hover:shadow-[4px_4px_0px_#000000] dark:border-white/15 dark:bg-zinc-900/70 dark:hover:border-white/30 dark:hover:shadow-[4px_4px_0px_#ff4e26]"
              >
                <div>
                  <div className="mb-4 flex items-center justify-between">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#ff4e26]">
                      {item.badge}
                    </span>
                    <Icon size={18} className="text-zinc-500 transition-colors group-hover:text-black dark:text-zinc-400 dark:group-hover:text-white" />
                  </div>

                  <h3 className="font-mono text-lg font-black tracking-tight text-zinc-900 dark:text-white">
                    {item.title}
                  </h3>

                  <p className="mt-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                    {item.description}
                  </p>
                </div>

                <div className="mt-6 border-t border-black/10 pt-3 dark:border-white/10">
                  <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold text-zinc-800 dark:text-zinc-200">
                    <ShieldCheck size={13} className="text-emerald-600 dark:text-emerald-400" />
                    {item.highlight}
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
