"use client"

import { useState } from "react"
import Link from "next/link"
import { Check, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"

interface ConnectClientProps {
  mcpUrl: string
}

export function ConnectClient({ mcpUrl }: ConnectClientProps) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle")
  const prompt = `Connect to my Résumer MCP server at ${mcpUrl}, provide the sign-in link, then call check_readiness as soon as I sign in and follow its guidance.`

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopyStatus("copied")
    } catch {
      setCopyStatus("error")
    }
  }

  return (
    <div className="page-wrap flex-1 py-8 md:py-12">
      <div className="mx-auto max-w-4xl">
        <header className="border-b border-zinc-200 pb-8 dark:border-zinc-700">
          <p className="mb-3 text-sm font-bold text-[#ff4e26]">Agents Automate</p>
          <h1 className="max-w-3xl text-3xl font-black uppercase tracking-tight sm:text-4xl md:text-5xl">
            Automate Resume Generation Through Agents
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-300 sm:text-base">
            Connect Résumer to your coding or AI agent, then generate tailored résumés using your saved profile and a job description.
          </p>
        </header>

        <section aria-labelledby="prompt-heading" className="my-8 border border-zinc-900 bg-white p-5 shadow-[4px_4px_0_#18181b] dark:border-zinc-600 dark:bg-zinc-900 dark:shadow-[4px_4px_0_#3f3f46] sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-200 pb-4 dark:border-zinc-700">
            <div>
              <h2 id="prompt-heading" className="text-xl font-black tracking-tight">Give this to your agent</h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Copy the whole prompt into your agent to start setup.</p>
            </div>
            <Button onClick={handleCopy} className="gap-2">
              {copyStatus === "copied" ? <Check size={16} /> : <Copy size={16} />}
              {copyStatus === "copied" ? "Copied" : "Copy prompt"}
            </Button>
          </div>
          <p className="mt-5 break-words text-base leading-7 text-zinc-800 selection:bg-[#ff4e26] selection:text-white dark:text-zinc-200 sm:text-lg sm:leading-8">{prompt}</p>
          <p role="status" className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            {copyStatus === "error" ? "Could not copy automatically. Select the prompt above and copy it manually." : copyStatus === "copied" ? "Prompt copied to clipboard." : ""}
          </p>
        </section>

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
