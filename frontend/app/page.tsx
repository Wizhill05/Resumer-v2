import { auth, signIn } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { redirect } from "next/navigation"

export default async function Home() {
  const session = await auth()

  if (session) {
    redirect("/dashboard")
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-zinc-950 to-zinc-900 text-white">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <span className="text-xl font-bold tracking-tight">Resumer</span>
        <div className="flex gap-3">
          <form
            action={async () => {
              "use server"
              await signIn("github")
            }}
          >
            <Button type="submit" variant="outline" className="border-zinc-700 text-white hover:bg-zinc-800 bg-transparent">
              Sign in with GitHub
            </Button>
          </form>
          <form
            action={async () => {
              "use server"
              await signIn("google")
            }}
          >
            <Button type="submit" variant="outline" className="border-zinc-700 text-white hover:bg-zinc-800 bg-transparent">
              Sign in with Google
            </Button>
          </form>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex flex-col items-center text-center px-6 pt-24 pb-16 max-w-4xl mx-auto">
        <Badge className="mb-6 bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-800">
          Free to use — no credit card required
        </Badge>
        <h1 className="text-5xl font-extrabold tracking-tight leading-tight mb-6">
          ATS-optimized resumes,
          <br />
          <span className="text-blue-400">generated in seconds.</span>
        </h1>
        <p className="text-lg text-zinc-400 max-w-2xl mb-10">
          Paste a job description. Pick a template. Watch an AI pipeline tailor
          your resume to the role — highlights, keywords, and all.
        </p>
        <div className="flex gap-4 flex-wrap justify-center">
          <form
            action={async () => {
              "use server"
              await signIn("github")
            }}
          >
            <Button type="submit" size="lg" className="bg-blue-500 hover:bg-blue-600 text-white px-8">
              Get started with GitHub
            </Button>
          </form>
          <form
            action={async () => {
              "use server"
              await signIn("google")
            }}
          >
            <Button type="submit" size="lg" variant="outline" className="border-zinc-600 text-white hover:bg-zinc-800 bg-transparent px-8">
              Continue with Google
            </Button>
          </form>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 py-16 grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          {
            title: "LangGraph Pipeline",
            desc: "Multi-agent pipeline: analyzes the job, selects your best projects, rewrites bullets, assembles a tailored resume.",
          },
          {
            title: "Live Progress",
            desc: "Watch the pipeline run step-by-step via SSE streaming — no polling, no waiting in the dark.",
          },
          {
            title: "PDF Auto-fit",
            desc: "WeasyPrint renders your resume. Font size auto-adjusts to keep everything on a single page.",
          },
        ].map((f) => (
          <div
            key={f.title}
            className="rounded-xl bg-zinc-800/50 border border-zinc-700/60 p-6"
          >
            <h3 className="font-semibold text-white mb-2">{f.title}</h3>
            <p className="text-sm text-zinc-400 leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </section>

      {/* Footer */}
      <footer className="text-center text-sm text-zinc-600 py-10">
        Resumer v2 — Free &amp; open source
      </footer>
    </main>
  )
}
