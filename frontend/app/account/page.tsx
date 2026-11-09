import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { needsWelcome } from "@/lib/welcome-gate"
import { Nav } from "@/components/Nav"
import { Footer } from "@/components/Footer"
import { AccountClient } from "./AccountClient"

export default async function AccountPage() {
  const session = await auth()
  if (!session?.user) redirect("/")
  if (needsWelcome(session)) redirect("/welcome")

  const provider =
    (session as { provider?: string }).provider ??
    (session.user as { provider?: string }).provider

  return (
    <main className="app-surface flex flex-1 flex-col">
      <Nav signedIn />

      <AccountClient
        name={session.user.name ?? null}
        email={session.user.email ?? null}
        image={session.user.image ?? null}
        provider={provider ?? null}
      />

      <Footer />
    </main>
  )
}
