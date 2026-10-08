"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  KeyRound,
  AlertCircle,
  FileText,
  Layers,
  Sparkles,
  HelpCircle,
} from "lucide-react"

interface ConnectClientProps {
  mcpUrl: string
}

export function ConnectClient({ mcpUrl }: ConnectClientProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(mcpUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
      setCopied(false)
    }
  }

  return (
    <div className="page-wrap flex-1 space-y-6 py-6 md:py-8">
      {/* Page Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-8 border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <div className="page-header space-y-2 border-0 bg-transparent p-0 shadow-none dark:bg-transparent md:p-0">
          <p className="text-xs font-extrabold uppercase tracking-widest text-[#ff4e26]">
            ChatGPT connector
          </p>
          <h1 className="text-2xl font-black uppercase tracking-tight md:text-3xl">
            Add Resumer to ChatGPT
          </h1>
          <p className="max-w-2xl text-sm font-medium leading-relaxed text-zinc-600 dark:text-zinc-400">
            Generate and tailor single-page, ATS-formatted resumes directly inside ChatGPT using your stored profile facts and job descriptions.
          </p>
        </div>
        <div className="hidden md:flex flex-col items-end gap-1 text-right">
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Protocol
          </span>
          <span className="text-xs font-mono font-bold text-zinc-800 dark:text-zinc-200">
            Remote MCP / Streamable HTTP
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.65fr_0.92fr] gap-6 lg:gap-8 items-start">
        {/* Left Column: Endpoint + Setup + Details */}
        <div className="space-y-6">
          {/* MCP Endpoint Box */}
          <section className="border border-zinc-900 bg-white p-5 md:p-6 shadow-[3px_3px_0_#18181b] dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-[3px_3px_0_#27272a]">
            <div className="flex items-center justify-between gap-4 pb-3 border-b border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <Layers size={16} className="text-[#ff4e26]" />
                <h2 className="text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
                  MCP server endpoint
                </h2>
              </div>
              <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                HTTPS
              </span>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              Copy this URL and paste it into ChatGPT when creating a custom connector:
            </p>

            <div className="mt-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="flex-1 overflow-x-auto rounded border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-xs font-mono font-semibold text-zinc-800 dark:text-zinc-200 selection:bg-[#ff4e26] selection:text-white">
                {mcpUrl}
              </div>
              <Button
                variant="default"
                size="sm"
                onClick={handleCopy}
                className="shrink-0 flex items-center justify-center gap-1.5"
              >
                {copied ? (
                  <>
                    <Check size={14} />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy size={14} />
                    <span>Copy URL</span>
                  </>
                )}
              </Button>
            </div>
          </section>

          {/* Setup Guide */}
          <section className="border border-zinc-900 bg-white p-5 md:p-6 shadow-[3px_3px_0_#18181b] dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-[3px_3px_0_#27272a]">
            <div className="flex items-center gap-2 pb-3 border-b border-zinc-200 dark:border-zinc-800">
              <Sparkles size={16} className="text-[#ff4e26]" />
              <h2 className="text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
                Setup steps
              </h2>
            </div>

            <ol className="mt-4 space-y-4 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-black text-white dark:bg-zinc-100 dark:text-zinc-900">
                  1
                </span>
                <div>
                  <p className="font-bold text-zinc-900 dark:text-zinc-100">
                    Open connector settings in ChatGPT
                  </p>
                  <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">
                    Go to <strong>Settings</strong> → <strong>Connectors</strong> (or Plugins), then select <strong>Create custom connector</strong>.
                  </p>
                </div>
              </li>

              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-black text-white dark:bg-zinc-100 dark:text-zinc-900">
                  2
                </span>
                <div>
                  <p className="font-bold text-zinc-900 dark:text-zinc-100">
                    Paste the MCP endpoint URL
                  </p>
                  <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">
                    Paste the copied URL into the connector configuration. ChatGPT will inspect the endpoint and discover the available Resumer tools.
                  </p>
                </div>
              </li>

              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-black text-white dark:bg-zinc-100 dark:text-zinc-900">
                  3
                </span>
                <div>
                  <p className="font-bold text-zinc-900 dark:text-zinc-100">
                    Sign in on the consent screen
                  </p>
                  <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">
                    ChatGPT prompts you to authorize the connector. Follow the prompt to sign in with your Resumer account using Google or GitHub and grant access.
                  </p>
                </div>
              </li>

              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-black text-white dark:bg-zinc-100 dark:text-zinc-900">
                  4
                </span>
                <div>
                  <p className="font-bold text-zinc-900 dark:text-zinc-100">
                    Start a chat and ask for a resume
                  </p>
                  <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">
                    In any chat where the connector is enabled, paste a job description or ask ChatGPT to draft, review, or tailor your resume from your profile.
                  </p>
                </div>
              </li>
            </ol>
          </section>

          {/* Capabilities */}
          <section className="border border-zinc-900 bg-white p-5 md:p-6 shadow-[3px_3px_0_#18181b] dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-[3px_3px_0_#27272a]">
            <div className="flex items-center gap-2 pb-3 border-b border-zinc-200 dark:border-zinc-800">
              <FileText size={16} className="text-[#ff4e26]" />
              <h2 className="text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
                What the connector does
              </h2>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
              The connector links your Resumer account directly to ChatGPT. Instead of copying career notes back and forth, ChatGPT reads your verified work history, formats bullet points, and generates production-ready PDF files.
            </p>

            <div className="mt-4 space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
                When ChatGPT uses it
              </p>
              <ul className="list-disc pl-4 space-y-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                <li>Reading your saved projects, experiences, education, and skills.</li>
                <li>Checking if your profile has enough entries for a selected template.</li>
                <li>Generating a job-tailored resume from a job description.</li>
                <li>Verifying layout bounds to catch awkward line breaks and overflow before compiling.</li>
                <li>Compiling and returning direct download links for the rendered PDF.</li>
                <li>Updating master profile entries when you add new achievements.</li>
              </ul>
            </div>
          </section>
        </div>

        {/* Right Column: Account Requirements + Troubleshooting */}
        <aside className="space-y-6 lg:sticky lg:top-[68px]">
          {/* Plan Requirements */}
          <div className="border border-zinc-900 bg-white p-5 shadow-[3px_3px_0_#18181b] dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-[3px_3px_0_#27272a]">
            <div className="flex items-center gap-2 pb-2 border-b border-zinc-200 dark:border-zinc-800">
              <AlertCircle size={15} className="text-amber-500" />
              <h3 className="text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
                Plan requirements
              </h3>
            </div>
            <div className="mt-3 space-y-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              <p>
                ChatGPT custom connectors require an active paid ChatGPT plan (Plus, Team, or Enterprise).
              </p>
              <p>
                OpenAI also requires enabling custom or developer connectors in your account settings before third-party MCP endpoints can be added.
              </p>
            </div>
          </div>

          {/* Troubleshooting */}
          <div className="border border-zinc-900 bg-white p-5 shadow-[3px_3px_0_#18181b] dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-[3px_3px_0_#27272a]">
            <div className="flex items-center gap-2 pb-2 border-b border-zinc-200 dark:border-zinc-800">
              <HelpCircle size={15} className="text-[#ff4e26]" />
              <h3 className="text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
                Troubleshooting
              </h3>
            </div>

            <div className="mt-3 space-y-3.5 text-xs">
              <div>
                <p className="flex items-center gap-1.5 font-bold text-zinc-900 dark:text-zinc-100">
                  <RefreshCw size={12} className="text-zinc-500" />
                  Tools not appearing
                </p>
                <p className="mt-1 leading-relaxed text-zinc-600 dark:text-zinc-400">
                  Open the Resumer connector in ChatGPT Settings and click <strong>Refresh</strong> to re-fetch the tool registry.
                </p>
              </div>

              <div>
                <p className="flex items-center gap-1.5 font-bold text-zinc-900 dark:text-zinc-100">
                  <KeyRound size={12} className="text-zinc-500" />
                  Authentication errors
                </p>
                <p className="mt-1 leading-relaxed text-zinc-600 dark:text-zinc-400">
                  Delete the connector in ChatGPT and add it again to restart the OAuth authorization handshake.
                </p>
              </div>

              <div>
                <p className="flex items-center gap-1.5 font-bold text-zinc-900 dark:text-zinc-100">
                  <ExternalLink size={12} className="text-zinc-500" />
                  Expired session
                </p>
                <p className="mt-1 leading-relaxed text-zinc-600 dark:text-zinc-400">
                  When authorization tokens expire, ChatGPT will prompt you to reconnect. Sign in again on the consent screen to restore access.
                </p>
              </div>
            </div>
          </div>

          {/* Quick Links */}
          <div className="border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/60 p-4">
            <h4 className="text-[11px] font-black uppercase tracking-widest text-zinc-700 dark:text-zinc-300">
              Related
            </h4>
            <div className="mt-2.5 flex flex-col gap-1.5 text-xs font-medium">
              <Link
                href="/support"
                className="text-zinc-700 dark:text-zinc-300 hover:text-[#ff4e26] dark:hover:text-[#ff4e26] transition-colors"
              >
                Support and bug reports →
              </Link>
              <Link
                href="/privacy"
                className="text-zinc-700 dark:text-zinc-300 hover:text-[#ff4e26] dark:hover:text-[#ff4e26] transition-colors"
              >
                Privacy policy →
              </Link>
              <Link
                href="/profile"
                className="text-zinc-700 dark:text-zinc-300 hover:text-[#ff4e26] dark:hover:text-[#ff4e26] transition-colors"
              >
                Manage your profile →
              </Link>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
