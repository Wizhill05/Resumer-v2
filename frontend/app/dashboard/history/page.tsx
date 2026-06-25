import { auth, signOut } from "@/lib/auth"
import { redirect } from "next/navigation"
import { HistoryClient } from "./HistoryClient"
import { Navigation } from "@/components/Navigation"

export default async function HistoryPage() {
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
            History
          </h1>
          <p className="text-zinc-500 font-semibold">
            View and download your previously tailored resume versions.
          </p>
        </div>

        <HistoryClient />
      </div>
    </Navigation>
  )
}
