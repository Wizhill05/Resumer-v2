import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { needsWelcome } from "@/lib/welcome-gate"
import { Nav } from "@/components/Nav"
import { Footer } from "@/components/Footer"
import { ProfileClient } from "@/app/profile/ProfileClient"

export default async function OnboardingPage() {
  const session = await auth()
  if (!session) redirect("/")
  if (needsWelcome(session)) redirect("/welcome")

  return (
    <main className="flex-1 flex flex-col bg-app text-ink">
      <Nav signedIn />
      <div className="page-wrap flex-1 space-y-4 md:space-y-5">
        <div className="page-header space-y-0.5">
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">Build Profile</h1>
          <p className="text-xs font-medium text-ink-muted md:text-sm">
            Import old résumés or enter details to start generating.
          </p>
        </div>
        <ProfileClient />
      </div>
      <Footer />
    </main>
  )
}
