import { auth, signOut } from "@/lib/auth"
import { redirect } from "next/navigation"
import { GenerateClient } from "./GenerateClient"
import { Navigation } from "@/components/Navigation"

export default async function GeneratePage() {
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
            Generate Resume
          </h1>
          <p className="text-zinc-500 font-semibold">
            Tailor a layout and compile it for your next target job.
          </p>
        </div>

        <GenerateClient />
      </div>
    </Navigation>
  )
}
