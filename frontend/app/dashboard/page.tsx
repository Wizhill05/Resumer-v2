import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { Nav } from "@/components/Nav"
import { DashboardClient } from "./DashboardClient"
import { Footer } from "@/components/Footer"

export default async function DashboardPage() {
  const session = await auth()
  if (!session) redirect("/")

  const firstName = session.user?.name?.split(" ")[0] ?? "there"

  return (
    <main className="flex-1 flex flex-col bg-[#fbfbf3] dark:bg-zinc-900 text-black dark:text-white">
      <Nav />

      <div className="border-b border-zinc-200 bg-[#ff4e26] dark:border-zinc-800">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-3 px-4 py-4 md:flex-row md:items-end md:px-6 md:py-8">
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-widest text-white/80">Resume workflow</p>
            <h1 className="text-2xl font-extrabold uppercase leading-none tracking-tight text-white md:text-5xl">
              Hey, {firstName}.
            </h1>
            <p className="mt-1.5 max-w-xl text-xs font-semibold leading-relaxed text-white/90 md:text-sm">
              Build your profile first. Then generate focused resumes from stronger source material.
            </p>
          </div>
          <div className="hidden md:grid md:w-auto md:grid-cols-3 md:gap-2 md:text-center">
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

      <div className="page-wrap flex-1">
        <DashboardClient />
      </div>

      <Footer />
    </main>
  )
}
