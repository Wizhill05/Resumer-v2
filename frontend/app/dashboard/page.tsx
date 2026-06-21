import { auth, signOut } from "@/lib/auth"
import { redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import Link from "next/link"

export default async function DashboardPage() {
  const session = await auth()
  if (!session) redirect("/")

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <nav className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between max-w-6xl mx-auto">
        <span className="font-bold text-lg">Resumer</span>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/dashboard" className="text-white">Dashboard</Link>
          <Link href="/profile" className="text-zinc-400 hover:text-white">Profile</Link>
          <Link href="/dashboard/history" className="text-zinc-400 hover:text-white">History</Link>
          <form
            action={async () => {
              "use server"
              await signOut({ redirectTo: "/" })
            }}
          >
            <Button type="submit" variant="ghost" size="sm" className="text-zinc-400 hover:text-white">
              Sign out
            </Button>
          </form>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold mb-2">
          Welcome, {session.user?.name ?? "there"}
        </h1>
        <p className="text-zinc-400 mb-10">
          Build tailored, ATS-optimized resumes for every job you apply to.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="rounded-xl bg-zinc-800/50 border border-zinc-700/60 p-6">
            <h2 className="font-semibold text-white mb-1">Generate Resume</h2>
            <p className="text-sm text-zinc-400 mb-4">
              Paste a job description and let the AI pipeline tailor your resume.
            </p>
            <Link href="/dashboard/generate">
              <Button className="bg-blue-500 hover:bg-blue-600 text-white w-full">
                Tailor Resume
              </Button>
            </Link>
          </div>

          <div className="rounded-xl bg-zinc-800/50 border border-zinc-700/60 p-6">
            <h2 className="font-semibold text-white mb-1">Build Your Profile</h2>
            <p className="text-sm text-zinc-400 mb-4">
              Add your experience, projects, education, and skills.
            </p>
            <Link href="/profile">
              <Button variant="outline" className="border-zinc-600 text-white hover:bg-zinc-700 bg-transparent w-full">
                Edit Profile
              </Button>
            </Link>
          </div>

          <div className="rounded-xl bg-zinc-800/50 border border-zinc-700/60 p-6">
            <h2 className="font-semibold text-white mb-1">View History</h2>
            <p className="text-sm text-zinc-400 mb-4">
              Access and download all your previously generated resumes.
            </p>
            <Link href="/dashboard/history">
              <Button variant="outline" className="border-zinc-600 text-white hover:bg-zinc-700 bg-transparent w-full">
                View History
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
