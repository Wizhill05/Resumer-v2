"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LoginModal } from "@/components/LoginModal"
import { ReportIssueButton } from "@/components/support/ReportIssueButton"
import { captureDownload } from "@/lib/posthog"

type GuestRun = {
  id: string
  status: string
  job_title?: string | null
  company?: string | null
  error_message?: string | null
}

const nodeProgressMap: Record<string, number> = {
  job_analysis: 10,
  selection: 18,
  summary_skills: 26,
  experience_writer: 34,
  projects_writer: 42,
  extracurricular_writer: 50,
  assembly: 58,
  renderer: 68,
  orphan_repair: 76,
  content_reduction: 84,
  saver: 95,
}

const nodeLabels: Record<string, string> = {
  job_analysis: "Analyzing job post",
  selection: "Selecting content",
  summary_skills: "Writing summary & skills",
  experience_writer: "Writing experience",
  projects_writer: "Writing projects",
  extracurricular_writer: "Writing extracurriculars",
  assembly: "Assembling résumé",
  renderer: "Rendering PDF",
  orphan_repair: "Fixing layout issues",
  content_reduction: "Optimizing fit",
  saver: "Saving files",
}

export function GuestResultClient({ id }: { id: string }) {
  const [run, setRun] = useState<GuestRun | null>(null)
  const [percent, setPercent] = useState(10)
  const [stepLabel, setStepLabel] = useState("Starting")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let since = 0
    const load = async () => {
      try {
        const res = await fetch(`/api/guest/generate/${id}`)
        const body = await res.json()
        if (!res.ok) throw new Error(body.detail || body.error || "Failed to load generation")
        if (active) setRun(body)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load generation")
      }
    }
    const poll = async () => {
      try {
        const res = await fetch(`/api/guest/generate/${id}/logs?since=${since}`)
        if (!res.ok) return
        const data = await res.json()
        for (const log of data.logs ?? []) {
          since = log.id
          if (log.node && nodeProgressMap[log.node]) setPercent((prev) => Math.max(prev, nodeProgressMap[log.node]))
          if (log.node && nodeLabels[log.node]) setStepLabel(nodeLabels[log.node])
        }
        if (data.status === "completed") setPercent(100)
        if (active) setRun((old) => old ? { ...old, status: data.status } : old)
        if (data.status === "completed" || data.status === "failed") load()
      } catch {
        // retry next tick
      }
    }
    load()
    poll()
    const timer = setInterval(poll, 3000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [id])

  const status = run?.status ?? "in_progress"
  return (
    <section className="py-10">
      {error && <div className="mb-4 flex gap-2 border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-sm font-bold text-red-700 dark:text-red-400 rounded-md"><AlertCircle size={18} /> {error}</div>}
      <div className="panel-strong space-y-5 p-6 md:p-8">
        <div>
          <p className="text-xs font-bold text-[#ff4e26]">Guest generation</p>
          <h1 className="mt-2 text-4xl font-bold leading-[0.92] tracking-[-0.045em] md:text-6xl dark:text-white">
            {status === "completed" ? "Résumé ready." : status === "failed" ? "Generation failed." : "Résumé cooking."}
          </h1>
          <p className="mt-3 text-sm font-bold text-ink-muted">
            {run?.job_title || "Tailored Résumé"}{run?.company ? ` at ${run.company}` : ""}
          </p>
        </div>
        <div className="h-3 overflow-hidden border border-line-strong bg-paper rounded-md">
          <div className="h-full bg-[#ff4e26] transition-all duration-500" style={{ width: `${status === "completed" ? 100 : percent}%` }} />
        </div>
        {/* Login nudge during generation - prompts user to sign in so the resume saves to their history */}
        {status !== "completed" && status !== "failed" && (
          <div className="flex items-center justify-between gap-3 border border-line bg-ink/[0.03] px-3 py-2.5 rounded-md">
            <p className="text-xs font-semibold text-ink-muted">
              Sign in to save this résumé to your history automatically.
            </p>
            <LoginModal
              callbackUrl="/dashboard?importGuestDraft=1"
              triggerClassName="shrink-0 border border-line-strong bg-paper px-3 py-1.5 text-xs font-bold text-ink hover:bg-ink/5 dark:hover:bg-ink/[0.06] shadow-soft rounded-md"
            />
          </div>
        )}
        {status === "failed" && (
          <div className="space-y-3">
            <p className="text-sm font-bold text-red-700 dark:text-red-400">{run?.error_message || "Pipeline failed. Try again with more complete details."}</p>
            <div className="flex flex-wrap gap-2">
              <ReportIssueButton
                defaultCategory="generation"
                defaultMessage={`[Guest generation failed]\nRun ID: ${id}\nError: ${run?.error_message || "unknown"}\nStatus: failed\n\nWhat job description did you paste?\n`}
                generationId={id}
                title="Report guest generation failure"
                description="Run ID is prefilled. Add job description context."
                variant="outline"
                size="sm"
                className="font-bold border-red-300 text-red-700 hover:bg-red-50 bg-paper"
              >
                Report this failure
              </ReportIssueButton>
              <Link href="/support" className="inline-flex items-center justify-center border border-line bg-paper px-3 py-2 text-xs font-bold rounded-md">
                Open support
              </Link>
            </div>
          </div>
        )}
        {status === "completed" && (
          <div className="border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 rounded-md">
            <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">
              Your résumé is ready. Download it now.
            </p>
            <p className="mt-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              Log in to save it to your account and access it anytime.
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          {status === "completed" ? (
            <a
              href={`/api/guest/generate/${id}/preview`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                captureDownload(id, "guest")
              }}
              className="inline-flex min-h-12 items-center justify-center border border-line-strong bg-[#ff4e26] px-5 text-sm font-bold text-white shadow-soft rounded-md"
            >
              <CheckCircle2 size={18} className="mr-2" /> Download PDF
            </a>
          ) : status === "failed" ? null : (
            <span className="inline-flex min-h-12 cursor-not-allowed items-center justify-center border border-line bg-ink/5 px-5 text-sm font-bold text-ink-faint rounded-md">
              <Loader2 className="mr-2 animate-spin" size={18} /> {stepLabel}…
            </span>
          )}
          <Link href="/try" className="inline-flex min-h-12 items-center justify-center border border-line-strong bg-paper px-5 text-sm font-bold text-ink shadow-soft rounded-md">Make another</Link>
          <LoginModal callbackUrl="/dashboard?importGuestDraft=1" triggerClassName="inline-flex min-h-12 items-center justify-center border border-line-strong bg-[#ff4e26] px-5 text-sm font-bold text-white shadow-soft rounded-md" />
        </div>
        <p className="text-xs font-bold text-ink-muted">Login saves history and keeps future résumés tied to your account.</p>
      </div>
    </section>
  )
}
