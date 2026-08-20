import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { HistoryClient } from "./HistoryClient"
import { Nav } from "@/components/Nav"
import { Footer } from "@/components/Footer"

export default async function HistoryPage() {
  const session = await auth()
  if (!session) redirect("/")

  return (
    <main className="flex-1 flex flex-col bg-[#fbfbf3] dark:bg-zinc-900 text-black dark:text-white">
      <Nav />

      <div className="page-wrap flex-1 space-y-4 md:space-y-5">
        <div className="page-header space-y-0.5">
          <h1 className="text-xl font-extrabold uppercase tracking-tight md:text-2xl">Generation History</h1>
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 md:text-sm">
            Download or edit your previous builds.
          </p>
        </div>

        <HistoryClient />
      </div>

      <Footer />
    </main>
  )
}
