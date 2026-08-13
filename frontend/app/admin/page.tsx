import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { Nav } from "@/components/Nav"
import { AdminClient } from "./AdminClient"
import { Footer } from "@/components/Footer"

export default async function AdminPage() {
  const session = await auth()
  if (!session) redirect("/")

  return (
    <main className="flex-1 flex flex-col bg-[#fbfbf3] dark:bg-zinc-900 text-black dark:text-white">
      <Nav />
      <div className="border-b border-zinc-200 bg-zinc-900">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-4 py-5 md:flex-row md:items-end md:px-6 md:py-8">
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-widest text-[#ff4e26]">System Management</p>
            <h1 className="text-3xl font-extrabold uppercase leading-none tracking-tight text-white md:text-5xl">
              Admin Dashboard
            </h1>
            <p className="mt-2 max-w-xl text-sm font-semibold leading-relaxed text-zinc-400">
              Manage LLM prompts, trace active resume generations, inspect platform analytics, and override user rate limits.
            </p>
          </div>
        </div>
      </div>

      <div className="page-wrap flex-1">
        <AdminClient />
      </div>

      <Footer />
    </main>
  )
}
