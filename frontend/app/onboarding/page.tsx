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
    <main className="app-surface flex flex-1 flex-col">
      <Nav signedIn />
      <ProfileClient />
      <Footer />
    </main>
  )
}
