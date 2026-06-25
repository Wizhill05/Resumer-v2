import { auth, signOut } from "@/lib/auth"
import { redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import Link from "next/link"

export default async function DashboardPage() {
  const session = await auth()
  if (!session) redirect("/")

  return (
    <main className="min-h-screen bg-[#fbfbf3] text-black">
      <nav className="border-b-3 border-black px-6 py-4 bg-white">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link href="/dashboard" className="text-xl font-extrabold uppercase border-2 border-black bg-yellow-400 px-3 py-1 shadow-[2px_2px_0px_#000000]">
            Resumer
          </Link>
          <div className="flex items-center gap-4 text-sm font-bold">
            <Link href="/dashboard" className="text-[#ff4e26] underline decoration-2">Dashboard</Link>
            <Link href="/profile" className="text-black hover:text-[#ff4e26]">Profile</Link>
            <Link href="/dashboard/history" className="text-black hover:text-[#ff4e26]">History</Link>
            <form
              action={async () => {
                "use server"
                await signOut({ redirectTo: "/" })
              }}
            >
              <Button type="submit" variant="ghost" size="sm" className="font-bold border-transparent">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-12 space-y-6">
        <div className="border-3 border-black bg-white p-6 shadow-[4px_4px_0px_#000000] space-y-2">
          <h1 className="text-3xl font-extrabold uppercase tracking-tight">
            Welcome, {session.user?.name ?? "there"}!
          </h1>
          <p className="text-zinc-700 font-medium">
            Build tailored, ATS-optimized resumes for every job description.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="border-3 border-black bg-white p-6 shadow-[4px_4px_0px_#000000] flex flex-col justify-between hover:-translate-y-1 transition-all">
            <div>
              <h2 className="font-extrabold text-lg uppercase tracking-wider mb-2">Generate Resume</h2>
              <p className="text-sm font-medium text-zinc-700 mb-6">
                Paste a job description and let the AI pipeline adapt your resume to match the role perfectly.
              </p>
            </div>
            <Link href="/dashboard/generate">
              <Button className="w-full">
                Tailor Resume
              </Button>
            </Link>
          </div>

          <div className="border-3 border-black bg-white p-6 shadow-[4px_4px_0px_#000000] flex flex-col justify-between hover:-translate-y-1 transition-all">
            <div>
              <h2 className="font-extrabold text-lg uppercase tracking-wider mb-2">Build Your Profile</h2>
              <p className="text-sm font-medium text-zinc-700 mb-6">
                Add and manage your work experience, projects, education, and skills.
              </p>
            </div>
            <Link href="/profile">
              <Button variant="outline" className="w-full bg-transparent text-black">
                Edit Profile
              </Button>
            </Link>
          </div>

          <div className="border-3 border-black bg-white p-6 shadow-[4px_4px_0px_#000000] flex flex-col justify-between hover:-translate-y-1 transition-all">
            <div>
              <h2 className="font-extrabold text-lg uppercase tracking-wider mb-2">View History</h2>
              <p className="text-sm font-medium text-zinc-700 mb-6">
                Access and download all previously generated and tailored resume versions.
              </p>
            </div>
            <Link href="/dashboard/history">
              <Button variant="outline" className="w-full bg-transparent text-black">
                View History
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
