import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { HistoryClient } from "./HistoryClient"
import { Nav } from "@/components/Nav"
import { Footer } from "@/components/Footer"

export default async function HistoryPage() {
  const session = await auth()
  if (!session) redirect("/")

  return (
    <main className="min-h-screen flex flex-col app-bg text-black">
      <Nav />

      <div className="page-wrap flex-1 space-y-4 md:space-y-5">
        <div className="page-header space-y-1">
          <p className="text-xs font-extrabold uppercase tracking-widest text-[#ff4e26]">Step 3</p>
          <h1 className="text-2xl font-extrabold uppercase tracking-tight md:text-3xl">Generation History</h1>
          <p className="max-w-2xl text-sm font-medium leading-relaxed text-zinc-600">
            View and download your previously tailored resume versions.
          </p>
        </div>

        <HistoryClient />
      </div>

      <Footer />
    </main>
  )
}
