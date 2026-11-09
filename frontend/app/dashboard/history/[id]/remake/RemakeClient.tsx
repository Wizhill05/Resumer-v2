"use client"

import { captureDownload } from "@/lib/posthog"

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
  replace_project: "Swapping profile project into résumé",
  projects_writer: "Rewriting project achievements with AI",
  orphan_repair: "Checking & fixing layout line-wraps",
  render_pdf: "Rendering updated PDF document",
  saver: "Saving résumé & generating preview",
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
    <div className="mx-auto max-w-xl space-y-5 px-4 py-8 md:py-12">
      <div className="soft-card p-6 md:p-8">
        {/* Top Tag & Header */}
        <div className="mb-6 text-center space-y-1.5">
          <h2 className="text-xl font-bold tracking-tight text-ink md:text-2xl">
            {isComplete
              ? "Your résumé is ready"
              : isFailed
              ? "The remake ran into a problem"
              : "Remaking your résumé"}
          </h2>
          <p className="text-xs text-ink-muted md:text-sm">
            {isComplete ? "Sections updated and the PDF re-rendered." : `${stepLabel} (${percent}%)`}
          </p>
        </div>

        {/* Live Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs font-semibold text-ink-muted">
            <span>Progress</span>
            <span>{percent}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-ink/[0.06]">
            <div
              className={`h-full transition-all duration-500 ease-out ${
                isFailed ? "bg-red-500" : "bg-gradient-to-r from-[#ff7d5c] to-ember"
              }`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        {/* Advisory message while in progress */}
        {!isComplete && !isFailed && (
          <div className="mt-6 space-y-4 text-center">
            <p className="text-xs font-medium leading-relaxed text-ink-muted">
              This will run in the background anyway. You can safely leave this page or return to history anytime.
            </p>
            <div>
              <Link
                href="/dashboard/history"
                className="inline-flex items-center justify-center gap-1.5 rounded-md border border-line bg-paper px-3.5 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-ember/50 hover:text-ember"
              >
                <ArrowLeft size={13} />
                <span>Back to history</span>
              </Link>
            </div>
          </div>
        )}

        {/* Failure state */}
        {isFailed && (
          <div className="mt-6 space-y-4">
            <div className="p-3.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg flex items-start gap-2.5 text-xs text-red-700 dark:text-red-400">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{errorMessage || "An error occurred while remaking the project. Your original résumé remains safe."}</span>
            </div>
            <div className="flex justify-center gap-3">
              <Link
                href={`/dashboard/history/${runId}/edit`}
                className="inline-flex items-center justify-center gap-1.5 rounded-md border border-line bg-paper px-3.5 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-ember/50 hover:text-ember"
              >
                <Edit3 size={13} />
                <span>Return to editor</span>
              </Link>
              <Link
                href="/dashboard/history"
                className="inline-flex items-center gap-1.5 rounded-md bg-ember px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#e03d16]"
              >
                <History size={13} />
                <span>Go to history</span>
              </Link>
            </div>
          </div>
        )}

        {/* Completion state: Exactly the 3 requested action buttons */}
        {isComplete && (
          <div className="mt-8 space-y-4 pt-6 border-t border-line">
            <div className="flex items-center justify-center gap-2 text-xs font-semibold text-[var(--ok)]">
              <CheckCircle2 size={16} />
              <span>New project added and the layout checked.</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2">
              {/* 1. Edit the PDF that got generated */}
              <Link
                href={`/dashboard/history/${runId}/edit`}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-paper px-4 text-xs font-semibold text-ink-soft transition-colors hover:border-ember/50 hover:text-ember"
              >
                <Edit3 size={14} />
                <span>Edit résumé</span>
              </Link>

              {/* 2. Download the new PDF */}
              <a
                href={`/api/backend/generate/${runId}/download`}
            onClick={() => captureDownload(runId, "remake")}
                download
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-ember px-4 text-xs font-semibold text-white shadow-[0_1px_2px_rgb(35_10_4/14%)] transition-colors hover:bg-[#e03d16]"
              >
                <Download size={14} />
                <span>Download PDF</span>
              </a>

              {/* 3. Go to the history */}
              <Link
                href="/dashboard/history"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-paper px-4 text-xs font-semibold text-ink-soft transition-colors hover:border-ember/50 hover:text-ember"
              >
                <History size={14} />
                <span>Go to history</span>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
