import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { GenerateClient } from "./GenerateClient"
import { Nav } from "@/components/Nav"

export default async function GeneratePage() {
  const session = await auth()
  if (!session) redirect("/")

  return (
    <main className="min-h-screen texture-bg text-black">
      <Nav />

      <div className="max-w-4xl mx-auto px-6 py-12 space-y-6">
        <div className="border-3 border-black bg-white p-6 shadow-[4px_4px_0px_#000000] space-y-2">
          <h1 className="text-3xl font-extrabold uppercase tracking-tight">Generate Tailored Resume</h1>
          <p className="text-zinc-700 font-medium">
            Select a template, paste the job description, and watch our multi-agent pipeline build your resume.
          </p>
        </div>

        <GenerateClient />
      </div>
    </main>
  )
}
