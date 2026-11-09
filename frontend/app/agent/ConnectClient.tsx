"use client"

import { useState } from "react"
import Link from "next/link"
import { Check } from "lucide-react"
import { AgentMarks } from "@/components/landing/AgentMarks"
import { FluidField } from "@/components/landing/FluidField"
import { agentPrompt } from "@/lib/agent-prompt"

interface ConnectClientProps {
  mcpUrl: string
}

export function ConnectClient({ mcpUrl }: ConnectClientProps) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle")
  const prompt = agentPrompt(mcpUrl)

  const copyWithSelection = () => {
    const previousFocus = document.activeElement
    const selection = window.getSelection()
    const ranges = selection
      ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index))
      : []
    const textarea = document.createElement("textarea")
    textarea.value = prompt
    textarea.readOnly = true
    textarea.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px"
    document.body.appendChild(textarea)
    try {
      textarea.focus({ preventScroll: true })
      textarea.select()
      textarea.setSelectionRange(0, textarea.value.length)
      return document.execCommand("copy")
    } finally {
      textarea.remove()
      if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true })
      selection?.removeAllRanges()
      ranges.forEach((range) => selection?.addRange(range))
    }
  }

  const handleCopy = async () => {
    // HTTP links need the synchronous selection method inside the click gesture.
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(prompt)
        setCopyStatus("copied")
        return
      } catch {
        // A denied Clipboard API permission can still allow selection copying.
      }
    }
    try {
      setCopyStatus(copyWithSelection() ? "copied" : "error")
    } catch {
      setCopyStatus("error")
    }
  }

  return (
    <div className="-mt-11 flex-1">
      <section aria-labelledby="agent-heading" className="agent-hero">
        <FluidField className="agent-field" sheen={false} />
        <div className="agent-hero-content">
          <h1 id="agent-heading">Connect your agent</h1>
          <p className="agent-intro"><AgentMarks /><span className="agent-intro-text">Give your agent this prompt to get started.</span></p>
          <div className="agent-prompt-stage">
            <div className="agent-rectangles" aria-hidden="true"><span /><span /><span /></div>
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy the agent prompt"
              aria-describedby="agent-copy-status"
              className="agent-prompt"
              data-copied={copyStatus === "copied"}
            >
              <span className="agent-prompt-text"><span aria-hidden="true">“</span>{prompt}<span aria-hidden="true">”</span></span>
            </button>
          </div>
          <p id="agent-copy-status" role="status" aria-live="polite" className="agent-copy-status">
            {copyStatus === "copied" && <Check size={16} aria-hidden="true" />}
            {copyStatus === "error" ? "Copy was blocked. Select and copy the prompt below." : copyStatus === "copied" ? "Prompt copied to clipboard." : "Click the prompt to copy."}
          </p>
          {copyStatus === "error" && (
            <textarea
              className="agent-manual-copy"
              aria-label="Select the agent prompt to copy manually"
              readOnly
              value={prompt}
              onFocus={(event) => event.currentTarget.select()}
            />
          )}
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

        {/* Small print at the very end of the page - what "agent" means here. */}
        <section aria-labelledby="agent-meaning-heading" className="border-t border-zinc-200 py-8 dark:border-zinc-800">
          <h2 id="agent-meaning-heading" className="text-sm font-bold">What “agent” means here</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            A desktop coding agent you run locally (Claude Code, Codex,
            Antigravity, OpenCode, Pi agent). Not the ChatGPT web app or chat
            interface, nor the Gemini chat interface. Chat interfaces are also
            supported: just paste the prompt and the agent walks you through
            the whole setup, step by step.
          </p>
        </section>
      </div>
    </div>
  )
}
