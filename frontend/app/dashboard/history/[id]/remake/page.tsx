import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { Nav } from "@/components/Nav"
import { Footer } from "@/components/Footer"
import { PageHero } from "@/components/PageHero"
import { RemakeClient } from "./RemakeClient"

type Props = {
  params: Promise<{ id: string }>
}

export default async function RemakePage({ params }: Props) {
  const { id } = await params
  const session = await auth()
  if (!session) redirect("/")

  return (
    <main className="app-surface flex min-h-screen flex-col">
      <Nav />
      <PageHero
        narrow
        title="Swap a project"
        subtitle="Résumer rewrites the affected sections and re-renders the PDF."
        back={{ href: "/dashboard/history", label: "History" }}
      />
      <div className="flex-1">
        <RemakeClient runId={id} />
      </div>
      <Footer />
    </main>
  )
}
