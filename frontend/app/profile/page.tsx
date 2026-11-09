import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { needsWelcome } from "@/lib/welcome-gate"
import { ProfileClient } from "./ProfileClient"
import { Nav } from "@/components/Nav"
import { Footer } from "@/components/Footer"

export default async function ProfilePage() {
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
