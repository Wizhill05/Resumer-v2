"use client"

import Link from "next/link"
import { useState } from "react"
import { ArrowUpRight, Check, Copy } from "lucide-react"
import { AgentMarks } from "@/components/landing/AgentMarks"
import { agentPrompt } from "@/lib/agent-prompt"
import styles from "./Landing.module.css"

/** One terminal line: the MCP endpoint, and a button that copies the agent prompt. */
export function AgentLine({ mcpUrl }: { mcpUrl: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle")

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(agentPrompt(mcpUrl))
      setStatus("copied")
      window.setTimeout(() => setStatus("idle"), 2200)
    } catch {
      setStatus("error")
    }
  }

  return (
    <section
      aria-labelledby="agent-line-heading"
      className={`${styles.agentBand} relative px-5 py-24 sm:py-32`}
    >
      <div className="landing-reveal mx-auto max-w-2xl text-center">
        <div className="flex justify-center text-[var(--fluid-ink)]">
          <AgentMarks />
        </div>
        <h2
          id="agent-line-heading"
          className="mt-5 text-balance text-4xl font-light tracking-[-0.04em] text-[var(--fluid-ink)] sm:text-5xl lg:text-6xl"
        >
          Or hand it to your agent.
        </h2>

        <div className={`${styles.terminal} mt-10 sm:mt-12`}>
          <span className={styles.prompt} aria-hidden="true">
            mcp
          </span>
          <code>
            {mcpUrl.replace(/^https?:\/\//, "")}
            <span className={styles.cursor} aria-hidden="true" />
          </code>
          <button type="button" onClick={copy} className={styles.copy}>
            {status === "copied" ? <Check size={13} /> : <Copy size={13} />}
            {status === "copied" ? "Copied" : "Copy prompt"}
          </button>
        </div>
        <p role="status" className="mt-3 min-h-5 text-xs text-[var(--fluid-ink-soft)]">
          {status === "error" ? "Copy was blocked. Open the agent page to copy it." : ""}
        </p>

        <Link
          href="/agent"
          className="group mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--fluid-ink)] underline decoration-[var(--fluid-ink)]/30 underline-offset-4 transition-colors hover:decoration-[var(--fluid-ink)]"
        >
          How it connects
          <ArrowUpRight
            size={14}
            className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            aria-hidden="true"
          />
        </Link>
      </div>
    </section>
  )
}
