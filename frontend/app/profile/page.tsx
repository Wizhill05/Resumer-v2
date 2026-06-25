import { auth, signOut } from "@/lib/auth"
import { redirect } from "next/navigation"
import { ProfileClient } from "./ProfileClient"
import { Navigation } from "@/components/Navigation"

export default async function ProfilePage() {
  const session = await auth()
  if (!session) redirect("/")

  async function handleSignOut() {
    "use server"
    await signOut({ redirectTo: "/" })
  }

  return (
    <Navigation signOutAction={handleSignOut}>
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="font-heading text-4xl font-extrabold tracking-tight text-zinc-900 uppercase">
            Your Profile
          </h1>
          <p className="text-zinc-500 font-semibold">
            Fill in your details. The AI pipeline uses this data to tailor your resumes.
          </p>
        </div>

        <ProfileClient />
      </div>
    </Navigation>
  )
}
