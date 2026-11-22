import type { Metadata } from "next"
import { auth } from "@/lib/auth"
import { Nav } from "@/components/Nav"
import { Footer } from "@/components/Footer"
import { PageHero } from "@/components/PageHero"
import { ConfirmOwnModel } from "./ConfirmOwnModel"

export const metadata: Metadata = {
  title: "Use your agent's model",
  robots: { index: false, follow: false },
  // Older links carried the one-time token in the query; never forward it to other sites.
  referrer: "no-referrer",
}

/**
 * Confirms an agent's request to write résumés with its own model.
 *
 * The agent's link carries a one-time challenge in the URL fragment (`#c=...`), which browsers
 * never send to a server, so it stays out of request logs. Everything that touches the token runs
 * in ConfirmOwnModel; this server component only knows whether someone is signed in.
 */
export default async function OwnModelConfirmPage() {
  const session = await auth()
  const signedIn = !!session?.user

  return (
    <main className="app-surface flex flex-1 flex-col">
      <Nav signedIn={signedIn} />
      <PageHero
        narrow
        title="Use your agent's model"
        subtitle="Let the AI agent you connected write your résumés with its own model."
      />
      <div className="page-wrap flex-1">
        <div className="mx-auto max-w-2xl">
          <ConfirmOwnModel signedIn={signedIn} email={session?.user?.email ?? null} />
        </div>
      </div>
      <Footer />
    </main>
  )
}
