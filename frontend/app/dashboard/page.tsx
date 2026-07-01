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
    <main className="min-h-screen flex flex-col app-bg text-black">
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

      <div className="page-wrap flex-1">
        <DashboardClient />
      </div>

      <Footer />
    </main>
  )
}
