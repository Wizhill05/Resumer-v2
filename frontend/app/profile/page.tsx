import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { ProfileClient } from "./ProfileClient"

export default async function ProfilePage() {
  const session = await auth()
  if (!session) redirect("/")

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <nav className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between max-w-6xl mx-auto">
        <span className="font-bold text-lg">Resumer</span>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/dashboard" className="text-zinc-400 hover:text-white">Dashboard</Link>
          <Link href="/profile" className="text-white">Profile</Link>
          <Link href="/dashboard/history" className="text-zinc-400 hover:text-white">History</Link>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-12">
        <h1 className="text-2xl font-bold mb-2">Your Profile</h1>
        <p className="text-zinc-400 mb-8">
          Fill in your details. The AI pipeline uses this data to build tailored resumes.
        </p>

        <ProfileClient />
      </div>
    </main>
  )
}
