import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { GenerateClient } from "./GenerateClient"

export default async function GeneratePage() {
  const session = await auth()
  if (!session) redirect("/")

  return (
    <main className="min-h-screen texture-bg text-black">
      <nav className="border-b-3 border-black px-6 py-4 bg-white">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link href="/dashboard" className="text-xl font-extrabold uppercase border-2 border-black bg-yellow-400 px-3 py-1 shadow-[2px_2px_0px_#000000]">
            Resumer
          </Link>
          <div className="flex items-center gap-4 text-sm font-bold">
            <Link href="/dashboard" className="text-black hover:text-[#ff4e26]">Dashboard</Link>
            <Link href="/profile" className="text-black hover:text-[#ff4e26]">Profile</Link>
            <Link href="/dashboard/history" className="text-black hover:text-[#ff4e26]">History</Link>
          </div>
        </div>
      </nav>

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
