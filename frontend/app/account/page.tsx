import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { Nav } from "@/components/Nav"
import { Footer } from "@/components/Footer"
import { AccountClient } from "./AccountClient"

export default async function AccountPage() {
  const session = await auth()
  if (!session?.user) redirect("/")

  const provider =
    (session as { provider?: string }).provider ??
    (session.user as { provider?: string }).provider

  return (
    <main className="flex flex-1 flex-col bg-[#fbfbf3] text-black dark:bg-zinc-900 dark:text-white">
      <Nav />

      <div className="page-wrap flex-1 space-y-4 md:space-y-5">
        <div className="page-header space-y-0.5">
          <h1 className="text-xl font-extrabold tracking-tight uppercase md:text-2xl">
            Account
          </h1>
          <p className="text-xs font-medium text-zinc-600 md:text-sm dark:text-zinc-400">
            Signed-in identity, contact email, and quick links.
          </p>
        </div>

        <AccountClient
          name={session.user.name ?? null}
          email={session.user.email ?? null}
          image={session.user.image ?? null}
          provider={provider ?? null}
        />
      </div>

      <Footer />
    </main>
  )
}
