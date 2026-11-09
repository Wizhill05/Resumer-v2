"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { CircleDot, CircleCheck, Loader2, MessageSquare } from "lucide-react"
import { z } from "zod"
import {
  issueSchema,
  issueHref,
  issueTitle,
  savedGuestIssues,
  statusLabels,
  supportFetch,
  type SupportIssue
} from "./supportApi"
import { getCategoryLabel } from "./supportCategories"

export function SupportInbox({ signedIn }: { signedIn: boolean }) {
  const [issues, setIssues] = useState<(SupportIssue & { token?: string })[]>([])
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading")
  const [filter, setFilter] = useState<"open" | "closed">("open")
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    async function load() {
      try {
        let parsed: SupportIssue[] = []
        try {
          parsed = z.array(issueSchema).parse(await supportFetch("/api/support"))
        } catch {}
        // Server-listed guest tickets carry an access token so links work on reload.
        const own: (SupportIssue & { token?: string })[] = parsed.map((row) => ({
          ...row,
          token: row.access_token ?? undefined
        }))
        const guests = await Promise.allSettled(
          savedGuestIssues().map(async (saved) => ({
            ...issueSchema.parse(
              await supportFetch(
                `/api/support/${saved.id}?access_token=${encodeURIComponent(saved.token)}`
              )
            ),
            token: saved.token
          }))
        )
        const all = new Map<string, SupportIssue & { token?: string }>(own.map((issue) => [issue.id, issue]))
        for (const guest of guests)
          if (guest.status === "fulfilled" && !all.has(guest.value.id))
            all.set(guest.value.id, guest.value)
        if (active) {
          setIssues(
            Array.from(all.values()).sort((a, b) => b.created_at.localeCompare(a.created_at))
          )
          setState("loaded")
        }
      } catch {
        if (active) setState("error")
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [signedIn, reload])
  const isOpen = (issue: SupportIssue) => issue.status === "open" || issue.status === "in_progress"
  const visible = issues.filter((issue) => (filter === "open" ? isOpen(issue) : !isOpen(issue)))
  return (
    <div className="space-y-6">
      <section
        className="soft-card overflow-hidden"
        aria-label="Your issues"
      >
        <div
          className="flex flex-wrap gap-4 border-b border-line bg-ink/[0.03] px-4"
          role="group"
          aria-label="Filter issues"
        >
          {(["open", "closed"] satisfies ("open" | "closed")[]).map((value) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              className={`min-h-12 border-b text-sm font-bold ${filter === value ? "border-[#ff4e26] text-ink" : "border-transparent text-ink-muted"}`}
            >
              {value === "open" ? "Open" : "Closed"}{" "}
              <span className="ml-1 text-xs text-ink-muted">
                {
                  issues.filter((issue) => (value === "open" ? isOpen(issue) : !isOpen(issue)))
                    .length
                }
              </span>
            </button>
          ))}
        </div>
        {state === "loading" ? (
          <p className="flex items-center gap-2 p-6 text-sm text-ink-muted">
            <Loader2 size={16} className="animate-spin" /> Loading your issues...
          </p>
        ) : state === "error" ? (
          <div role="alert" className="p-6 text-sm">
            <p>Could not load your issues.</p>
            <button
              className="mt-3 min-h-11 font-bold underline"
              onClick={() => {
                setState("loading")
                setReload((value) => value + 1)
              }}
            >
              Try again
            </button>
          </div>
        ) : visible.length ? (
          <ul className="divide-y divide-line">
            {visible.map((issue) => (
              <li key={issue.id}>
                <Link
                  href={issueHref(issue.id, issue.token)}
                  className="flex min-w-0 gap-3 p-4 hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-[#ff4e26] dark:hover:bg-ink/[0.06]"
                >
                  {isOpen(issue) ? (
                    <CircleDot size={20} className="mt-0.5 shrink-0 text-[#ff4e26]" />
                  ) : (
                    <CircleCheck size={20} className="mt-0.5 shrink-0 text-ink-muted" />
                  )}
                  <div className="min-w-0">
                    <h2 className="break-words text-sm font-bold leading-6">{issueTitle(issue)}</h2>
                    <p className="mt-1 text-xs leading-5 text-ink-muted">
                      {statusLabels[issue.status]} · {getCategoryLabel(issue.category)} ·{" "}
                      {new Date(issue.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-5 py-10 text-center">
            <MessageSquare size={28} className="mx-auto mb-3 text-ink-faint" />
            <h2 className="font-bold">
              {filter === "open" ? "No open issues" : "No closed issues"}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-muted">
              {filter === "open"
                ? "Need a hand or have an idea? Start an issue and we'll reply in the same conversation."
                : "Resolved conversations will appear here."}
            </p>
          </div>
        )}
      </section>
      {!signedIn && (
        <p className="text-xs leading-5 text-ink-muted">
          Guest issues are saved in this browser. Keep each issue&apos;s private link to return from
          another device. Sign in before submitting to keep issues in your account.
        </p>
      )}
      <details className="border-t border-line pt-4">
        <summary className="cursor-pointer py-2 text-sm font-bold">
          Before you open an issue
        </summary>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
          For a failed generation, try once more and use Report issue on that run to include its ID.
          For import problems, use a text-based PDF. You can add screenshots and more details when
          you create your issue.
        </p>
      </details>
    </div>
  )
}
