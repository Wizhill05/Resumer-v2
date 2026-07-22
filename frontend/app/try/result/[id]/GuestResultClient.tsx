"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LoginModal } from "@/components/LoginModal"

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
  assembly: "Assembling resume",
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
      {error && <div className="mb-4 flex gap-2 border-2 border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700"><AlertCircle size={18} /> {error}</div>}
      <div className="panel-strong space-y-5 p-6 md:p-8">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[#ff4e26]">Guest generation</p>
          <h1 className="mt-2 text-4xl font-black uppercase leading-[0.92] tracking-[-0.045em] md:text-6xl">
            {status === "completed" ? "Resume ready." : status === "failed" ? "Generation failed." : "Resume cooking."}
          </h1>
          <p className="mt-3 text-sm font-bold text-zinc-600">
            {run?.job_title || "Tailored Resume"}{run?.company ? ` at ${run.company}` : ""}
          </p>
        </div>
        <div className="h-3 overflow-hidden border border-zinc-950 bg-white">
          <div className="h-full bg-[#ff4e26] transition-all duration-500" style={{ width: `${status === "completed" ? 100 : percent}%` }} />
        </div>
        {/* Login nudge during generation — prompts user to sign in so the resume saves to their history */}
        {status !== "completed" && status !== "failed" && (
          <div className="flex items-center justify-between gap-3 border border-zinc-200 bg-zinc-50 px-3 py-2.5">
            <p className="text-xs font-semibold text-zinc-600">
              Sign in to save this resume to your history automatically.
            </p>
            <LoginModal
              callbackUrl="/dashboard?importGuestDraft=1"
              triggerClassName="shrink-0 border border-zinc-950 bg-white px-3 py-1.5 text-xs font-black uppercase tracking-wide text-zinc-950 hover:bg-zinc-100 shadow-[2px_2px_0_#18181b]"
            />
          </div>
        )}
        {status === "failed" && <p className="text-sm font-bold text-red-700">{run?.error_message || "Pipeline failed. Try again with more complete details."}</p>}
        {status === "completed" && (
          <div className="border-2 border-emerald-300 bg-emerald-50 px-4 py-3">
            <p className="text-sm font-black uppercase tracking-wide text-emerald-800">
              Your resume is ready. Download it now.
            </p>
            <p className="mt-0.5 text-xs font-semibold text-emerald-700">
              Log in to save it to your account and access it anytime.
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          {status === "completed" ? (
            <a href={`/api/guest/generate/${id}/preview`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center justify-center border-2 border-zinc-950 bg-[#ff4e26] px-5 text-sm font-black uppercase tracking-wide text-white shadow-[3px_3px_0_#18181b]">
              <CheckCircle2 size={18} className="mr-2" /> Download PDF
            </a>
          ) : status === "failed" ? null : (
            <span className="inline-flex min-h-12 cursor-not-allowed items-center justify-center border-2 border-zinc-300 bg-zinc-100 px-5 text-sm font-black uppercase tracking-wide text-zinc-400">
              <Loader2 className="mr-2 animate-spin" size={18} /> {stepLabel}…
            </span>
          )}
          <Link href="/try" className="inline-flex min-h-12 items-center justify-center border-2 border-zinc-950 bg-white px-5 text-sm font-black uppercase tracking-wide text-zinc-950 shadow-[3px_3px_0_#18181b]">Make another</Link>
          <LoginModal callbackUrl="/dashboard?importGuestDraft=1" triggerClassName="inline-flex min-h-12 items-center justify-center border-2 border-zinc-950 bg-[#ff4e26] px-5 text-sm font-black uppercase tracking-wide text-white shadow-[3px_3px_0_#18181b]" />
        </div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">Login saves history and keeps future resumes tied to your account.</p>
      </div>
    </section>
  )
}
