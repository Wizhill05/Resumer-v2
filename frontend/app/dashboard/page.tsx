import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { needsWelcome } from "@/lib/welcome-gate"
import { Nav } from "@/components/Nav"
import { DashboardClient } from "./DashboardClient"
import { Footer } from "@/components/Footer"
import { PageHero } from "@/components/PageHero"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { ArrowRight, History } from "lucide-react"

export default async function DashboardPage() {
  const session = await auth()
  if (!session) redirect("/")
  if (needsWelcome(session)) redirect("/welcome")

  const firstName = session.user?.name?.split(" ")[0] ?? "there"

  return (
    <main className="app-surface flex flex-1 flex-col">
      <Nav signedIn />

      <PageHero
        title={`Hey, ${firstName}.`}
        subtitle="Paste a job post and Résumer tailors your profile into a one-page, ATS-safe PDF."
        actions={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Link href="/dashboard/history">
              <Button variant="outline" size="lg">
                <History size={16} aria-hidden="true" />
                Open history
              </Button>
            </Link>
            <Link href="/dashboard/generate">
              <Button size="lg">
                Generate résumé
                <ArrowRight size={16} aria-hidden="true" />
              </Button>
            </Link>
          </div>
        }
      />

      <div className="page-wrap flex-1">
        <DashboardClient />
      </div>

      <Footer />
    </main>
  )
}
