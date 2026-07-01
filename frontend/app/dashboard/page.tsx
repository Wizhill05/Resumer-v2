import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Nav } from "@/components/Nav"
import { Clock, FileText, UserRound } from "lucide-react"

export default async function DashboardPage() {
  const session = await auth()
  if (!session) redirect("/")

  const firstName = session.user?.name?.split(" ")[0] ?? "there"

  return (
    <main className="min-h-screen app-bg text-black">
      <Nav />

      <div className="border-b border-zinc-200 bg-[#ff4e26]">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-4 py-5 md:flex-row md:items-end md:px-6 md:py-8">
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-widest text-white/80">Resume workflow</p>
            <h1 className="text-3xl font-extrabold uppercase leading-none tracking-tight text-white md:text-5xl">
              Hey, {firstName}.
            </h1>
            <p className="mt-2 max-w-xl text-sm font-semibold leading-relaxed text-white/90">
              Build your profile first. Then generate focused resumes from stronger source material.
            </p>
          </div>
          <div className="grid w-full grid-cols-3 gap-2 text-center md:w-auto">
            {[
              ["01", "Profile"],
              ["02", "Tailor"],
              ["03", "Download"],
            ].map(([num, label]) => (
              <div key={num} className="border border-white/40 px-3 py-2">
                <p className="text-lg font-extrabold text-white">{num}</p>
                <p className="text-[10px] font-bold uppercase text-white/75">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="page-wrap space-y-4 md:space-y-5">
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="panel-strong overflow-hidden">
            <div className="h-1.5 bg-[#ff4e26]" />
            <div className="grid gap-4 p-4 md:grid-cols-[1fr_auto] md:items-center md:p-6">
              <div className="flex gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-zinc-900 bg-[#ff4e26] text-white md:h-12 md:w-12">
                  <UserRound size={20} />
                </div>
                <div>
                  <p className="text-xs font-extrabold uppercase tracking-widest text-[#ff4e26]">Step 1</p>
                  <h2 className="text-xl font-extrabold uppercase tracking-tight md:text-3xl">Build Your Profile</h2>
                  <p className="mt-1 max-w-xl text-sm font-medium leading-relaxed text-zinc-600">
                    Add experience, projects, education, and skills first. Resume focus options unlock from this data.
                  </p>
                </div>
              </div>
              <Link href="/profile" className="w-full md:w-auto">
                <Button size="lg" className="w-full md:w-auto">Edit Profile</Button>
              </Link>
            </div>
          </section>

          <aside className="panel p-4 md:p-5">
            <h3 className="text-sm font-extrabold uppercase tracking-wider">Why profile first?</h3>
            <p className="mt-2 text-sm font-medium leading-relaxed text-zinc-600">
              The generator can only select from saved profile entries. More projects and experience means more focus choices.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-bold text-zinc-600">
              <span className="border border-zinc-200 bg-zinc-50 p-2">Projects unlock project focus</span>
              <span className="border border-zinc-200 bg-zinc-50 p-2">Experience unlocks role focus</span>
            </div>
          </aside>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="compact-card p-4 md:p-5">
            <div className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-zinc-900 bg-zinc-950 text-white">
                <FileText size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-extrabold uppercase tracking-widest text-zinc-400">Step 2</p>
                <h2 className="text-lg font-extrabold uppercase tracking-tight">Generate Resume</h2>
                <p className="mt-1 text-sm font-medium leading-relaxed text-zinc-600">
                  Paste a job post, choose template and focus, then start generation.
                </p>
                <Link href="/dashboard/generate" className="mt-4 block">
                  <Button variant="outline" className="w-full md:w-auto">Generate Resume</Button>
                </Link>
              </div>
            </div>
          </section>

          <section className="compact-card p-4 md:p-5">
            <div className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-zinc-900 bg-yellow-300 text-zinc-950">
                <Clock size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-extrabold uppercase tracking-widest text-zinc-400">Step 3</p>
                <h2 className="text-lg font-extrabold uppercase tracking-tight">Download From History</h2>
                <p className="mt-1 text-sm font-medium leading-relaxed text-zinc-600">
                  Runs continue on the server. Return later to download completed PDFs.
                </p>
                <Link href="/dashboard/history" className="mt-4 block">
                  <Button variant="outline" className="w-full md:w-auto">View History</Button>
                </Link>
              </div>
            </div>
          </section>
        </div>

        <div className="panel flex flex-col gap-2 p-3 text-xs font-bold text-zinc-600 md:flex-row md:items-center md:justify-between md:px-4">
          <span className="uppercase tracking-wider text-zinc-400">Typical generation time</span>
          <span>5-10 minutes. Safe to close the tab after starting.</span>
        </div>
      </div>
    </main>
  )
}
