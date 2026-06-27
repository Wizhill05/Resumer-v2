import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { HistoryClient } from "./HistoryClient"
import { Nav } from "@/components/Nav"

export default async function HistoryPage() {
  const session = await auth()
  if (!session) redirect("/")

  return (
    <main className="min-h-screen texture-bg text-black">
      <Nav />

      <div className="max-w-6xl mx-auto px-6 py-12 space-y-6">
        <div className="border-3 border-black bg-white p-6 shadow-[4px_4px_0px_#000000] space-y-2">
          <h1 className="text-3xl font-extrabold uppercase tracking-tight">Generation History</h1>
          <p className="text-zinc-700 font-medium">
            View and download your previously tailored resume versions.
          </p>
        </div>

        <HistoryClient />
      </div>
    </main>
  )
}
