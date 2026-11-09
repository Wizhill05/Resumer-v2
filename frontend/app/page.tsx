import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { AuthErrorBanner } from "@/components/AuthErrorBanner"
import { LandingNav } from "@/components/landing/LandingNav"
import { LiveStage } from "@/components/landing/LiveStage"
import { ModeDial } from "@/components/landing/ModeDial"
import { AgentLine } from "@/components/landing/AgentLine"
import { Closing } from "@/components/landing/Closing"
import { Footer } from "@/components/Footer"

export default async function Home() {
  const session = await auth()

  if (session) {
    redirect("/dashboard")
  }

  const mcpUrl = process.env.NEXT_PUBLIC_MCP_URL || "https://api.resumer.buzz/mcp"

  return (
    <main className="relative flex min-h-screen flex-1 flex-col bg-white text-[var(--fluid-ink)] dark:bg-[#18181b]">
      <AuthErrorBanner />
      <LandingNav />
      <LiveStage />
      <ModeDial />
      <AgentLine mcpUrl={mcpUrl} />
      <Closing />
      <Footer variant="landing" />
    </main>
  )
}
