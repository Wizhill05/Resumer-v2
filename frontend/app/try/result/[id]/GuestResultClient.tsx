"use client"

import Link from "next/link"
import { AlertCircle, ArrowLeft, Download, Loader2, Mail, Plus } from "lucide-react"
import { ReportIssueButton } from "@/components/support/ReportIssueButton"
import { captureDownload } from "@/lib/posthog"
import { useGuestRun } from "@/lib/use-guest-run"

const primaryBtn =
  "inline-flex min-h-12 items-center justify-center gap-2 border border-line-strong bg-[#ff4e26] px-5 text-sm font-bold text-white shadow-soft rounded-md"
const secondaryBtn =
  "inline-flex min-h-12 items-center justify-center gap-2 border border-line-strong bg-paper px-5 text-sm font-bold text-ink shadow-soft rounded-md hover:bg-ink/5"

export function GuestResultClient({ id }: { id: string }) {
  const { run, status, percent, stepLabel, error } = useGuestRun(id)

  const expires = run?.expires_at ? new Date(run.expires_at) : null
  const expiresLabel = expires && !Number.isNaN(expires.getTime())
    ? expires.toLocaleDateString([], { month: "short", day: "numeric" })
    : null
  const done = status === "completed"
  const failed = status === "failed"
  const active = !done && !failed

  if (status === "missing") {
    return (
      <section className="py-10">
        <div className="panel-strong space-y-5 p-6 md:p-8">
          <div>
            <p className="text-xs font-bold text-[#ff4e26]">Guest generation</p>
            <h1 className="mt-2 text-4xl font-bold leading-[0.92] tracking-[-0.045em] md:text-6xl dark:text-white">
              Résumé not found.
            </h1>
            <p className="mt-3 text-sm font-bold text-ink-muted">
              We could not find this résumé. It may have expired, or it was made in a different browser.
              If you signed in after starting it, it&apos;s in your dashboard history.
            </p>
          </div>
          <Link href="/try" className={secondaryBtn}>
            <ArrowLeft size={16} /> Back to the editor
          </Link>
        </div>
      </section>
    )
  }

  return (
    <section className="py-10">
      {error && (
        <div className="mb-4 flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
          <AlertCircle size={18} /> {error}
        </div>
      )}
      <div className="panel-strong space-y-5 p-6 md:p-8">
        <div>
          <p className="text-xs font-bold text-[#ff4e26]">Guest generation</p>
          <h1 className="mt-2 text-4xl font-bold leading-[0.92] tracking-[-0.045em] md:text-6xl dark:text-white">
            {done ? "Résumé ready." : failed ? "Generation failed." : "Résumé cooking."}
          </h1>
          <p className="mt-3 text-sm font-bold text-ink-muted">
            {run?.job_title || "Tailored Résumé"}{run?.company && run.company !== "Unknown Company" ? ` at ${run.company}` : ""}
          </p>
        </div>

        <div className="h-3 overflow-hidden rounded-md border border-line-strong bg-paper">
          <div className="h-full bg-[#ff4e26] transition-all duration-500" style={{ width: `${done ? 100 : percent}%` }} />
        </div>

        {active && (
          <p className="text-xs font-semibold text-ink-muted">
            This takes a few minutes. You can go back and keep editing; this résumé stays in the bar at the top of the editor.
            {run?.notify_email ? ` We'll also email the PDF to ${run.notify_email}.` : ""}
          </p>
        )}

        {failed && (
          <div className="space-y-3">
            <p className="text-sm font-bold text-red-700 dark:text-red-400">{run?.error_message || "Pipeline failed. Try again with more complete details."}</p>
            <p className="text-xs font-semibold text-ink-muted">Your inputs are saved and this run didn&apos;t use a credit.</p>
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
              <Link href="/support" className="inline-flex items-center justify-center rounded-md border border-line bg-paper px-3 py-2 text-xs font-bold">
                Open support
              </Link>
            </div>
          </div>
        )}

        {done && (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 dark:border-emerald-800 dark:bg-emerald-950/40">
            <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">
              Your résumé is ready. Download it now.
            </p>
            <p className="mt-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              {expiresLabel ? `Available until ${expiresLabel}.` : "Available for 7 days."}
              {run?.notify_email ? (
                <span className="inline-flex items-center gap-1"> <Mail size={12} className="ml-1" /> A copy was sent to {run.notify_email}.</span>
              ) : null}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          {done ? (
            <a
              href={`/api/guest/generate/${id}/preview`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => captureDownload(id, "guest")}
              className={primaryBtn}
            >
              <Download size={18} /> Download PDF
            </a>
          ) : failed ? (
            <Link href="/try?tab=generate" className={primaryBtn}>
              Try again
            </Link>
          ) : (
            <span className="inline-flex min-h-12 cursor-not-allowed items-center justify-center gap-2 rounded-md border border-line bg-ink/5 px-5 text-sm font-bold text-ink-faint">
              <Loader2 className="animate-spin" size={18} /> {status === "loading" ? "Loading" : stepLabel}…
            </span>
          )}
          <Link href={done ? "/try?tab=generate" : "/try"} className={secondaryBtn}>
            {done ? <><Plus size={16} /> Make another</> : <><ArrowLeft size={16} /> Back to the editor</>}
          </Link>
        </div>
        <p className="text-xs font-bold text-ink-muted">
          Sign in (top right) to keep this résumé in your history and save your details to an account.
        </p>
      </div>
    </section>
  )
}
