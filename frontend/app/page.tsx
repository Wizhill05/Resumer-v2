import { auth } from "@/lib/auth"
import { Badge } from "@/components/ui/badge"
import { redirect } from "next/navigation"
import { LoginModal } from "@/components/LoginModal"

export default async function Home() {
  const session = await auth()

  if (session) {
    redirect("/dashboard")
  }

  return (
    <main className="min-h-screen texture-bg text-black">
      {/* Nav */}
      <nav className="border-b-3 border-black px-6 py-5 bg-white">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <span className="text-2xl font-extrabold tracking-tight uppercase border-2 border-black bg-yellow-400 px-3 py-1 shadow-[2px_2px_0px_#000000]">
            Resumer
          </span>
          <LoginModal />
        </div>
      </nav>

      {/* Hero */}
      <section className="flex flex-col items-center text-center px-6 pt-20 pb-16 max-w-4xl mx-auto space-y-6">
        <Badge variant="secondary" className="text-sm font-bold tracking-wide uppercase px-4 py-1">
          Free to use — no limits
        </Badge>
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight leading-none uppercase">
          ATS-optimized resumes,
          <br />
          <span className="bg-[#ff4e26] text-white border-3 border-black px-4 py-2 inline-block mt-4 shadow-[4px_4px_0px_#000000] rotate-[-1deg]">
            generated in seconds.
          </span>
        </h1>
        <p className="text-base md:text-lg text-zinc-800 max-w-2xl font-semibold border-2 border-black bg-white p-4 shadow-[3px_3px_0px_#000000] leading-relaxed">
          Paste a job description. Pick a template. Watch our multi-agent pipeline tailor
          your resume to the role — highlighting relevant accomplishments and extracting keywords automatically.
        </p>

        <LoginModal />
      </section>

      {/* Features Grid */}
      <section className="max-w-6xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              title: "LangGraph Agents",
              desc: "Multi-agent orchestration analyzes the job posts, parses skills gaps, rewrites resume bullets, and compiles tailored PDFs.",
              color: "bg-yellow-100",
            },
            {
              title: "Live Progress Bar",
              desc: "Watch pipeline nodes execute step-by-step via SSE stream without annoying page polling.",
              color: "bg-red-50",
            },
            {
              title: "Smart Auto-fit",
              desc: "WeasyPrint renders high-fidelity PDFs. Font sizes are automatically adjusted to fit precisely on a single page.",
              color: "bg-blue-50",
            },
          ].map((f) => (
            <div
              key={f.title}
              className={`border-3 border-black shadow-[4px_4px_0px_#000000] p-6 hover:-translate-y-1 transition-all ${f.color}`}
            >
              <h3 className="text-lg font-extrabold uppercase tracking-wider mb-2">{f.title}</h3>
              <p className="text-sm font-semibold text-zinc-700 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="text-center font-bold text-sm text-black py-12 border-t-3 border-black bg-white mt-12">
        RESUMER V2 — BUILT WITH NEO-BRUTALISM &amp; HEART
      </footer>
    </main>
  )
}
