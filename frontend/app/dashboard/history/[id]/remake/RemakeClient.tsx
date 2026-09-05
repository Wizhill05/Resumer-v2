"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  CheckCircle2,
  Download,
  Edit3,
  History,
  Loader2,
  AlertCircle,
  ArrowLeft,
  Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"

const nodeProgressMap: Record<string, number> = {
  replace_project_start: 15,
  replace_project: 30,
  projects_writer: 50,
  orphan_repair: 75,
  render_pdf: 88,
  saver: 95,
  completed: 100,
}

const nodeLabels: Record<string, string> = {
  replace_project_start: "Preparing project replacement",
  replace_project: "Swapping profile project into resume",
  projects_writer: "Rewriting project achievements with AI",
  orphan_repair: "Checking & fixing layout line-wraps",
  render_pdf: "Rendering updated PDF document",
  saver: "Saving resume & generating preview",
  completed: "Complete",
}

type Props = {
  runId: string
}

export function RemakeClient({ runId }: Props) {
  const [percent, setPercent] = useState(15)
  const [stepLabel, setStepLabel] = useState("Preparing project replacement")
  const [isComplete, setIsComplete] = useState(false)
  const [isFailed, setIsFailed] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let since = 0
    let timer: ReturnType<typeof setInterval> | null = null

    const poll = async () => {
      if (!active) return
      try {
        const res = await fetch(`/api/backend/generate/${runId}/logs?since=${since}`)
        if (!res.ok) return
        const data = await res.json()
        const logs = (data.logs ?? []) as Array<{
          id: number
          node: string | null
          message: string
          level: string
        }>

        for (const log of logs) {
          since = log.id
          if (
            log.level === "status" &&
            (log.message === "completed" || data.status === "completed")
          ) {
            active = false
            if (timer) clearInterval(timer)
            setPercent(100)
            setStepLabel("Complete")
            setIsComplete(true)
            return
          }
          if (log.level === "status" && (log.message === "failed" || data.status === "failed")) {
            active = false
            if (timer) clearInterval(timer)
            setIsFailed(true)
            setErrorMessage(log.message || "Remake failed")
            return
          }
          if (log.node) {
            const p = nodeProgressMap[log.node]
            if (p) setPercent((prev) => Math.max(prev, p))
            const label = nodeLabels[log.node]
            if (label) setStepLabel(label)
          }
        }

        if (data.status === "completed") {
          active = false
          if (timer) clearInterval(timer)
          setPercent(100)
          setStepLabel("Complete")
          setIsComplete(true)
        } else if (data.status === "failed") {
          active = false
          if (timer) clearInterval(timer)
          setIsFailed(true)
        }
      } catch (e) {
        console.error("Failed polling remake progress:", e)
      }
    }

    poll()
    timer = setInterval(poll, 1500)

    return () => {
      active = false
      if (timer) clearInterval(timer)
    }
  }, [runId])

  return (
    <div className="mx-auto max-w-xl space-y-5 py-8 md:py-14 px-4">
      <div className="border border-zinc-200 bg-white p-6 shadow-xs dark:border-zinc-800 dark:bg-zinc-900 md:p-8 rounded-xl">
        {/* Top Tag & Header */}
        <div className="mb-6 text-center space-y-1.5">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold tracking-wider uppercase bg-[#ff4e26]/10 text-[#ff4e26]">
            <Sparkles size={12} />
            <span>{isComplete ? "Done" : isFailed ? "Failed" : "In Progress"}</span>
          </div>
          <h2 className="text-xl font-extrabold uppercase tracking-tight text-zinc-900 dark:text-zinc-100 md:text-2xl">
            {isComplete
              ? "Project Replaced & Resume Remade"
              : isFailed
              ? "Project Remake Encountered an Issue"
              : "Remaking Resume with New Project"}
          </h2>
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400 md:text-sm">
            {isComplete ? "All sections updated & PDF rendered" : `${stepLabel} (${percent}%)`}
          </p>
        </div>

        {/* Live Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between font-mono text-xs font-bold text-zinc-600 dark:text-zinc-400">
            <span>Progress</span>
            <span>{percent}%</span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
            <div
              className={`h-full transition-all duration-500 ease-out ${
                isFailed ? "bg-red-500" : "bg-[#ff4e26]"
              }`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        {/* Advisory message while in progress */}
        {!isComplete && !isFailed && (
          <div className="mt-6 space-y-4 text-center">
            <p className="text-xs font-medium leading-relaxed text-zinc-500 dark:text-zinc-400">
              This will run in the background anyway. You can safely leave this page or return to history anytime.
            </p>
            <div>
              <Link
                href="/dashboard/history"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700 rounded-md transition-colors"
              >
                <ArrowLeft size={13} />
                <span>Back to History</span>
              </Link>
            </div>
          </div>
        )}

        {/* Failure state */}
        {isFailed && (
          <div className="mt-6 space-y-4">
            <div className="p-3.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg flex items-start gap-2.5 text-xs text-red-700 dark:text-red-400">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{errorMessage || "An error occurred while remaking the project. Your original resume remains safe."}</span>
            </div>
            <div className="flex justify-center gap-3">
              <Link
                href={`/dashboard/history/${runId}/edit`}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-bold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700 rounded-md transition-colors"
              >
                <Edit3 size={13} />
                <span>Return to Editor</span>
              </Link>
              <Link
                href="/dashboard/history"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#ff4e26] text-white text-xs font-bold hover:bg-[#e03d16] rounded-md transition-colors"
              >
                <History size={13} />
                <span>Go to History</span>
              </Link>
            </div>
          </div>
        )}

        {/* Completion state: Exactly the 3 requested action buttons */}
        {isComplete && (
          <div className="mt-8 space-y-4 pt-6 border-t border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center justify-center gap-2 text-emerald-600 dark:text-emerald-400 text-xs font-bold">
              <CheckCircle2 size={16} />
              <span>Resume has been updated with the new project &amp; layout checked!</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2">
              {/* 1. Edit the PDF that got generated */}
              <Link
                href={`/dashboard/history/${runId}/edit`}
                className="inline-flex items-center justify-center gap-2 h-10 px-4 border border-zinc-900 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 font-extrabold uppercase text-xs tracking-wider rounded-md shadow-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <Edit3 size={14} />
                <span>Edit Resume</span>
              </Link>

              {/* 2. Download the new PDF */}
              <a
                href={`/api/backend/generate/${runId}/download`}
                download
                className="inline-flex items-center justify-center gap-2 h-10 px-4 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 font-extrabold uppercase text-xs tracking-wider rounded-md shadow-xs transition-colors"
              >
                <Download size={14} />
                <span>Download PDF</span>
              </a>

              {/* 3. Go to the history */}
              <Link
                href="/dashboard/history"
                className="inline-flex items-center justify-center gap-2 h-10 px-4 border border-zinc-900 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 font-extrabold uppercase text-xs tracking-wider rounded-md shadow-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <History size={14} />
                <span>Go to History</span>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
