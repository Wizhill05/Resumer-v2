import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { Nav } from "@/components/Nav"
import { Footer } from "@/components/Footer"
import { PageHero } from "@/components/PageHero"
import { WelcomeClient } from "./WelcomeClient"

export default async function WelcomePage() {
  const session = await auth()
  if (!session) redirect("/")
  if (!(session as { needsWelcome?: boolean }).needsWelcome) redirect("/dashboard")

  const provider = (session as { provider?: string }).provider ?? null

  return (
    <main className="app-surface flex flex-1 flex-col">
      <Nav />

      <PageHero
        title="Welcome to Résumer."
        subtitle="A couple of quick details and we'll get your profile set up."
      />

      <div className="page-wrap flex-1">
        <div className="mx-auto w-full max-w-2xl">
          <Suspense
            fallback={
              <div className="flex justify-center p-8">
                <div className="flex gap-2">
                  <span className="loading-dot bg-[#ff4e26]" />
                  <span className="loading-dot bg-yellow-400" />
                  <span className="loading-dot bg-[#ff4e26]" />
                </div>
              </div>
            }
          >
            <WelcomeClient initialName={session.user?.name ?? null} provider={provider} />
          </Suspense>
        </div>
      </div>

      <Footer />
    </main>
  )
}
