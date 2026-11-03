"use client"

import { useState } from "react"
import Link from "next/link"
import { Check, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { agentPrompt } from "@/lib/agent-prompt"

interface ConnectClientProps {
  mcpUrl: string
}

export function ConnectClient({ mcpUrl }: ConnectClientProps) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle")
  const prompt = agentPrompt(mcpUrl)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopyStatus("copied")
    } catch {
      setCopyStatus("error")
    }
  }

  return (
    <div className="flex-1">
      <section aria-labelledby="agent-heading" className="flex min-h-[calc(100svh-2.75rem)] items-center justify-center px-5 py-16 sm:px-8">
        <h1 id="agent-heading" className="sr-only">Connect your agent</h1>
        <div className="w-full max-w-2xl">
          <div className="border border-zinc-900 bg-white p-6 shadow-[4px_4px_0_#18181b] dark:border-zinc-600 dark:bg-zinc-900 dark:shadow-[4px_4px_0_#3f3f46] sm:p-10">
            <p className="break-words text-base leading-7 text-zinc-800 selection:bg-[#ff4e26] selection:text-white dark:text-zinc-200 sm:text-lg sm:leading-8">{prompt}</p>
          </div>
          <Button onClick={handleCopy} size="lg" className="mt-5 h-14 w-full gap-2 text-base font-bold sm:mt-6">
            {copyStatus === "copied" ? <Check size={18} /> : <Copy size={18} />}
            {copyStatus === "copied" ? "Copied" : "Copy prompt"}
          </Button>
          <p role="status" className="mt-2 text-center text-sm text-zinc-600 dark:text-zinc-400">
            {copyStatus === "error" ? "Could not copy automatically. Select the prompt above and copy it manually." : copyStatus === "copied" ? "Prompt copied to clipboard." : ""}
          </p>
        </div>
      </section>

      <div className="page-wrap mx-auto max-w-4xl pb-16 pt-8 md:pb-24">
        <section aria-labelledby="steps-heading" className="py-2">
          <h2 id="steps-heading" className="text-2xl font-black tracking-tight">How to get started</h2>
          <ol className="mt-5 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
            {[
              ["Copy and send the prompt", "Open your preferred coding or AI agent and paste the prompt above. The agent needs to support remote MCP servers and OAuth, or be able to guide you through its setup."],
              ["Follow the sign-in link", "The agent will configure the connection or explain the steps it cannot perform. Open the authorization link it provides, sign in to Résumer, and approve access. Follow any instructions about which device must open the link or callback. Never share your password or tokens in the chat."],
              ["Check your profile", "Return to your agent after signing in. It should check your profile for missing information. Share an old résumé with the agent, or import PDFs or enter your details on your Résumer profile. Some agents may need a restart or a reconnect before tools appear."],
              ["Provide a job description", "Once the agent confirms your profile is ready, give it a job description and ask it to generate a tailored résumé. Review the result and follow the agent’s link to your PDF."],
            ].map(([title, description], index) => (
              <li key={title} className="flex gap-4 py-5 sm:gap-6">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center border border-zinc-900 text-sm font-black dark:border-zinc-400">{index + 1}</span>
                <div><h3 className="font-bold">{title}</h3><p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{description}</p></div>
              </li>
            ))}
          </ol>
          <p className="mt-5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            If setup fails, share the error with your agent and ask it to check the MCP connection and authentication. You can also <Link href="/profile" className="font-bold underline underline-offset-4 hover:text-[#ff4e26]">update your profile</Link> or visit <Link href="/support" className="font-bold underline underline-offset-4 hover:text-[#ff4e26]">support</Link>.
          </p>
        </section>
      </div>
    </div>
  )
}
