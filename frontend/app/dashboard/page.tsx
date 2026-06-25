import { auth, signOut } from "@/lib/auth"
import { redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Navigation } from "@/components/Navigation"
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"

export default async function DashboardPage() {
  const session = await auth()
  if (!session) redirect("/")

  async function handleSignOut() {
    "use server"
    await signOut({ redirectTo: "/" })
  }

  return (
    <Navigation signOutAction={handleSignOut}>
      <div className="space-y-8">
        {/* Welcome Section */}
        <div className="space-y-2">
          <h1 className="font-heading text-4xl font-extrabold tracking-tight text-zinc-900 uppercase">
            Hello, {session.user?.name ?? "there"}!
          </h1>
          <p className="text-zinc-500 font-semibold">
            Ready to tailor your resume for the next application?
          </p>
        </div>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="flex flex-col justify-between h-full">
            <CardHeader>
              <CardTitle className="uppercase tracking-wide">Generate Resume</CardTitle>
              <CardDescription className="pt-2">
                Paste a job description and let the multi-agent pipeline adapt your resume sections automatically.
              </CardDescription>
            </CardHeader>
            <div className="px-6 pb-6 mt-auto">
              <Link href="/dashboard/generate">
                <Button className="w-full">
                  Tailor Resume
                </Button>
              </Link>
            </div>
          </Card>

          <Card className="flex flex-col justify-between h-full">
            <CardHeader>
              <CardTitle className="uppercase tracking-wide">Build Profile</CardTitle>
              <CardDescription className="pt-2">
                Update your professional experience, education, projects, and skills used as source truth.
              </CardDescription>
            </CardHeader>
            <div className="px-6 pb-6 mt-auto">
              <Link href="/profile">
                <Button variant="outline" className="w-full">
                  Edit Profile
                </Button>
              </Link>
            </div>
          </Card>

          <Card className="flex flex-col justify-between h-full">
            <CardHeader>
              <CardTitle className="uppercase tracking-wide">View History</CardTitle>
              <CardDescription className="pt-2">
                Access and download all previously generated and tailored resume versions at any time.
              </CardDescription>
            </CardHeader>
            <div className="px-6 pb-6 mt-auto">
              <Link href="/dashboard/history">
                <Button variant="outline" className="w-full">
                  View History
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </Navigation>
  )
}
