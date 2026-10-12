import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { HeroSection } from "@/components/landing/HeroSection"
import { StoryOverture } from "@/components/landing/StoryOverture"
import { StoryJourney } from "@/components/landing/StoryJourney"
import { StoryTransformation } from "@/components/landing/StoryTransformation"
import { StoryClosing } from "@/components/landing/StoryClosing"
import { Footer } from "@/components/Footer"

export default async function Home() {
  const session = await auth()

  if (session) {
    redirect("/dashboard")
  }

  return (
    <main className="relative flex min-h-screen flex-1 flex-col overflow-x-clip bg-[var(--fluid-canvas)] text-[var(--fluid-ink)]">
      <HeroSection />
      <StoryOverture />
      <StoryJourney />
      <StoryTransformation />
      <StoryClosing />
      <Footer variant="landing" />
    </main>
  )
}
