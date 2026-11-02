"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"

export function CopyAgentPrompt({ prompt }: { prompt: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle")

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setStatus("copied")
    } catch {
      setStatus("error")
    }
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1.5 border border-[var(--fluid-ink)]/25 bg-white/40 px-2 py-1 text-[11px] font-semibold text-[var(--fluid-ink)] backdrop-blur-sm transition-colors hover:border-[var(--fluid-ink)]/50 hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fluid-ink)] dark:border-white/25 dark:bg-white/5 dark:hover:border-white/50 dark:hover:bg-white/10 sm:text-xs"
      >
        {status === "copied" ? <Check size={12} /> : <Copy size={12} />}
        {status === "copied" ? "Copied" : "Copy prompt"}
      </button>
      <span role="status" className="sr-only">
        {status === "error" ? "Could not copy. Open the agent page to copy the prompt manually." : status === "copied" ? "Prompt copied." : ""}
      </span>
      {status === "error" && <span className="text-[11px] text-[var(--fluid-ink)]">Open the agent page to copy.</span>}
    </div>
  )
}
