import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { GenerateClient } from "./GenerateClient"
import { Nav } from "@/components/Nav"
import { Footer } from "@/components/Footer"

export default async function GeneratePage() {
  const session = await auth()
  if (!session) redirect("/")

  return (
    <main className="min-h-screen flex flex-col app-bg text-black">
      <Nav />

      <div className="page-wrap flex-1 max-w-4xl space-y-4 md:space-y-5">
        <div className="page-header space-y-1">
          <p className="text-xs font-extrabold uppercase tracking-widest text-[#ff4e26]">Step 2</p>
          <h1 className="text-2xl font-extrabold uppercase tracking-tight md:text-3xl">Generate Resume</h1>
          <p className="max-w-2xl text-sm font-medium leading-relaxed text-zinc-600">
            Pick a template, choose how your saved profile material is weighted, then paste the job description.
          </p>
        </div>

        <GenerateClient />
      </div>

      <Footer />
    </main>
  )
}
