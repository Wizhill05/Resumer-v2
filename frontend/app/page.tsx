import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { LoginModal } from "@/components/LoginModal"
import Link from "next/link"
import { Footer } from "@/components/Footer"

export default async function Home() {
  const session = await auth()

  if (session) {
    redirect("/dashboard")
  }

  return (
    <main className="min-h-screen flex flex-col overflow-hidden bg-[#fbfbf3] text-black">
      <nav className="px-5 py-5 md:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <span className="resumer-mark px-3 py-1.5 text-2xl font-black">
            Resumer
          </span>
          <LoginModal />
        </div>
      </nav>

      <section className="relative mx-auto grid max-w-6xl gap-12 px-5 pb-20 pt-12 md:grid-cols-[1.1fr_0.9fr] md:px-8 md:pb-28 md:pt-20">
        <div className="absolute left-[-12rem] top-24 h-72 w-72 rounded-full bg-[#ff4e26]/10 blur-3xl" />
        <div className="relative z-10">
          <p className="mb-5 inline-flex border border-zinc-900 bg-white px-3 py-1 text-xs font-extrabold uppercase tracking-[0.28em] shadow-[2px_2px_0_#18181b]">
            Free. Fast. Focused.
          </p>
          <h1 className="max-w-4xl text-5xl font-black uppercase leading-[0.86] tracking-[-0.08em] text-zinc-950 md:text-8xl">
            Resume engine for sharp first passes.
          </h1>
          <p className="mt-7 max-w-xl text-base font-semibold leading-relaxed text-zinc-600 md:text-lg">
            Build profile once. Paste job post. Resumer turns source material into clean, ATS-aware PDFs without making you fight blank pages.
          </p>
          <div className="login-highlight mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
            <LoginModal />
            <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Login is start button. No card needed.</span>
          </div>
        </div>

        <div className="relative min-h-[360px] md:min-h-[520px]">
          <div className="landing-orb landing-float absolute right-0 top-4 h-64 w-64 rounded-full md:h-96 md:w-96" />
          <div className="landing-card absolute left-0 top-24 w-[78%] rotate-[-2deg] p-5 md:left-6 md:top-32">
            <div className="mb-8 flex items-center justify-between text-xs font-extrabold uppercase tracking-widest text-zinc-400">
              <span>Profile</span><span>Ready</span>
            </div>
            <div className="space-y-3">
              <div className="h-3 w-4/5 rounded-full bg-zinc-950" />
              <div className="h-3 w-2/3 rounded-full bg-zinc-200" />
              <div className="h-3 w-5/6 rounded-full bg-zinc-200" />
            </div>
          </div>
          <div className="landing-card absolute bottom-10 right-0 w-[82%] rotate-[2deg] bg-zinc-950 p-5 text-white md:bottom-16">
            <div className="mb-5 text-xs font-extrabold uppercase tracking-[0.28em] text-[#ff4e26]">Matched bullets</div>
            <p className="text-2xl font-black uppercase leading-none tracking-[-0.06em] md:text-4xl">Role signal up. Noise down.</p>
            <div className="mt-6 grid grid-cols-3 gap-2">
              <span className="h-9 bg-[#ff4e26]" />
              <span className="h-9 bg-white" />
              <span className="h-9 bg-yellow-300" />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-10 md:px-8 md:py-16">
        <div className="mb-6 flex items-end justify-between gap-6">
          <h2 className="max-w-xl text-3xl font-black uppercase leading-none tracking-[-0.06em] md:text-5xl">Minimal surface. Heavy lifting underneath.</h2>
          <div className="hidden h-px flex-1 bg-zinc-300 md:block" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            {
              title: "Profile Memory",
              desc: "Keep source material organized once. Reuse it for every role.",
            },
            {
              title: "Job-Aware Drafting",
              desc: "Extracts role signals and rewrites bullets around evidence you already have.",
            },
            {
              title: "Clean PDF Output",
              desc: "Practical templates, single-page fit, and generation history built in.",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="landing-card p-6"
            >
              <h3 className="mb-8 text-lg font-black uppercase tracking-[-0.04em]">{f.title}</h3>
              <p className="text-sm font-semibold leading-relaxed text-zinc-600">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <Footer />
    </main>
  )
}
