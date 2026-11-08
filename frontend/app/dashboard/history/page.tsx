import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { HistoryClient } from "./HistoryClient"
import { Nav } from "@/components/Nav"
import { Footer } from "@/components/Footer"
import { PageHero } from "@/components/PageHero"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Plus } from "lucide-react"

export default async function HistoryPage() {
  const session = await auth()
  if (!session) redirect("/")

  return (
    <main className="app-surface flex flex-1 flex-col">
      <Nav />

      <PageHero
        title="History"
        subtitle="Preview, download or edit anything you've built."
        actions={
          <Link href="/dashboard/generate">
            <Button size="lg">
              <Plus size={16} aria-hidden="true" />
              New résumé
            </Button>
          </Link>
        }
      />

      <div className="page-wrap flex-1">
        <HistoryClient />
      </div>

      <Footer />
    </main>
  )
}
