import type { Metadata } from "next"
import { Nav } from "@/components/Nav"
import { Footer } from "@/components/Footer"
import { ConnectClient } from "./ConnectClient"

export const metadata: Metadata = {
  title: "Add to ChatGPT",
  description:
    "Connect Resumer to ChatGPT to build, tailor, and export single-page resumes directly inside your chats.",
}

export default function ConnectPage() {
  const mcpUrl =
    process.env.NEXT_PUBLIC_MCP_URL || "https://resumer-backend.aryansingh.space/mcp"

  return (
    <main className="flex-1 flex flex-col bg-[#fbfbf3] dark:bg-zinc-900 text-black dark:text-white min-h-screen font-sans">
      <Nav />
      <ConnectClient mcpUrl={mcpUrl} />
      <Footer />
    </main>
  )
}
