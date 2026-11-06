import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { GenerateClient } from "./GenerateClient"
import { Nav } from "@/components/Nav"
import { Footer } from "@/components/Footer"

export default async function GeneratePage() {
  const session = await auth()
  if (!session) redirect("/")

  return (
    <main className="flex-1 flex flex-col bg-[#fbfbf3] dark:bg-zinc-900 text-black dark:text-white">
      <Nav />

      <div className="page-wrap flex-1 max-w-4xl max-md:w-[calc(100%_-_2.5rem)] space-y-4 md:space-y-5">
        <div className="page-header space-y-0.5 max-md:border-l-0 max-md:p-0">
          <h1 className="text-xl font-extrabold uppercase tracking-tight md:text-2xl">Generate Résumé</h1>
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 md:text-sm">
            <span className="md:hidden">Start with the job. Your saved defaults are ready.</span>
            <span className="hidden md:inline">Target any job description in seconds.</span>
          </p>
        </div>

        <GenerateClient />
      </div>

      <Footer />
    </main>
  )
}
