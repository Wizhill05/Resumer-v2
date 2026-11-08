import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { ProfileClient } from "./ProfileClient"
import { Nav } from "@/components/Nav"
import { Footer } from "@/components/Footer"

export default async function ProfilePage() {
  const session = await auth()
  if (!session) redirect("/")

  return (
    <main className="app-surface flex flex-1 flex-col">
      <Nav />
      <ProfileClient />
      <Footer />
    </main>
  )
}
