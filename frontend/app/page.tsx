import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { HeroSection } from "@/components/landing/HeroSection"
import { FeatureGrid } from "@/components/landing/FeatureGrid"
import { Footer } from "@/components/Footer"

export default async function Home() {
  const session = await auth()

  if (session) {
    redirect("/dashboard")
  }

  return (
    <main className="flex-1 flex flex-col min-h-screen app-bg text-zinc-950 dark:text-white relative overflow-x-hidden">
      <div className="landing-noise" aria-hidden="true" />
      <HeroSection />
      <FeatureGrid />
      <Footer variant="landing" />
    </main>
  )
}
