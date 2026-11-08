import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { GenerateClient } from "./GenerateClient"
import { Nav } from "@/components/Nav"
import { Footer } from "@/components/Footer"
import { PageHero } from "@/components/PageHero"

export default async function GeneratePage() {
  const session = await auth()
  if (!session) redirect("/")

  return (
    <main className="app-surface flex flex-1 flex-col">
      <Nav />

      <PageHero
        title="Generate a résumé"
        subtitle="Paste the job. Résumer tailors your saved profile to it."
      />

      <div className="page-wrap flex-1 space-y-4 md:space-y-5">
        <GenerateClient />
      </div>

      <Footer />
    </main>
  )
}
