import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { HeroSection } from "@/components/landing/HeroSection"
import { LandingMetricsBanner } from "@/components/landing/LandingMetricsBanner"
import { ResumeDiffShowcase } from "@/components/landing/ResumeDiffShowcase"
import { FeatureGrid } from "@/components/landing/FeatureGrid"
import { AtsCompatibilityMatrix } from "@/components/landing/AtsCompatibilityMatrix"
import { SecuritySection } from "@/components/landing/SecuritySection"
import { Footer } from "@/components/Footer"

export default async function Home() {
  const session = await auth()

  if (session) {
    redirect("/dashboard")
  }

  return (
    <main className="flex-1 flex flex-col min-h-screen app-bg text-zinc-950 dark:text-white relative overflow-x-clip">
      <HeroSection />
      <LandingMetricsBanner />
      <ResumeDiffShowcase />
      <FeatureGrid />
      <AtsCompatibilityMatrix />
      <SecuritySection />
      <Footer variant="landing" />
    </main>
  )
}
