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
    <main className="relative flex min-h-screen flex-1 flex-col overflow-x-clip bg-white text-[var(--fluid-ink)] dark:bg-[#18181b]">
      <HeroSection />
      <StoryOverture />
      <section className="relative overflow-hidden px-5 py-20 sm:py-28 lg:py-32">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 items-start gap-16 lg:grid-cols-2 lg:gap-14 xl:gap-20">
            <StoryJourney />
            <StoryTransformation />
          </div>
        </div>
      </section>
      <StoryClosing />
      <Footer variant="landing" />
    </main>
  )
}
