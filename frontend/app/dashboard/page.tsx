import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { Nav } from "@/components/Nav"
import { DashboardClient } from "./DashboardClient"
import { Footer } from "@/components/Footer"
import { FluidField } from "@/components/landing/FluidField"

export default async function DashboardPage() {
  const session = await auth()
  if (!session) redirect("/")

  const firstName = session.user?.name?.split(" ")[0] ?? "there"

  return (
    <main className="flex-1 flex flex-col bg-[#fbfbf3] dark:bg-zinc-900 text-black dark:text-white">
      <Nav />

      <div className="relative -mt-11 md:-mt-[60px] overflow-hidden border-b border-black/10 dark:border-white/10">
        <FluidField variant="banner" />
        <div className="relative mx-auto max-w-6xl px-4 pt-20 pb-10 sm:pt-24 sm:pb-12 md:px-6 md:pt-32 md:pb-14">
          <h1 className="text-2xl leading-none font-extrabold tracking-tight text-[var(--fluid-ink)] md:text-4xl">
            Hey, {firstName}.
          </h1>
        </div>
      </div>

      <div className="page-wrap flex-1 py-4 sm:py-6">
        <DashboardClient />
      </div>

      <Footer />
    </main>
  )
}
