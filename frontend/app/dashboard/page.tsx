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
        <div className="mx-auto max-w-6xl px-4 py-4 md:px-6 md:py-6">
          <h1 className="text-2xl font-extrabold uppercase leading-none tracking-tight text-white md:text-4xl">
            Hey, {firstName}.
          </h1>
          <p className="mt-1 text-xs font-semibold text-white/85 md:text-sm">
            Generate tailored ATS resumes from your profile.
          </p>
        </div>
      </div>

      <div className="page-wrap flex-1">
        <DashboardClient />
      </div>

      <Footer />
    </main>
  )
}
