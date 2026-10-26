"use client"

import { useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { CircleDot, CheckCircle2, Paperclip, Search } from "lucide-react"
import { z } from "zod"
import { SUPPORT_CATEGORIES, getCategoryLabel } from "@/components/support/supportCategories"

const issueSchema = z.object({
  id: z.string(),
  title: z.string().nullish(),
  user_email: z.string().nullish(),
  user_name: z.string().nullish(),
  email_override: z.string().nullish(),
  message: z.string(),
  status: z.enum(["open", "in_progress", "resolved", "closed"]),
  category: z.string().nullish(),
  created_at: z.string(),
  updated_at: z.string().nullish(),
  attachment_count: z.number()
})

export function AdminIssueInbox() {
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("")
  const [category, setCategory] = useState("")
  const [limit, setLimit] = useState(50)
  const reports = useQuery({
    queryKey: ["admin", "feedback", "reports", search, status, category, limit],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(limit) })
      if (search.trim()) params.set("search", search.trim())
      if (status) params.set("status_filter", status)
      if (category) params.set("category_filter", category)
      const response = await fetch(`/api/backend/admin/feedback/reports?${params}`)
      if (!response.ok) throw new Error("Issues could not be loaded. Try again.")
      return z.array(issueSchema).parse(await response.json())
    },
    refetchInterval: 30000
  })

  return (
    <section aria-label="Support issues" className="ph-no-capture min-w-0 space-y-4">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <div className="relative min-w-0">
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-3.5 text-zinc-500"
          />
          <input
            aria-label="Search issues"
            placeholder="Search issues or senders"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setLimit(50)
            }}
            className="h-11 w-full border border-zinc-300 bg-white pl-9 pr-3 text-base dark:border-zinc-700 dark:bg-zinc-900 sm:text-sm"
          />
        </div>
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value)
            setLimit(50)
          }}
          className="h-11 min-w-0 border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-900 sm:text-sm"
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="resolved">Closed</option>
        </select>
        <select
          aria-label="Filter by category"
          value={category}
          onChange={(event) => {
            setCategory(event.target.value)
            setLimit(50)
          }}
          className="h-11 min-w-0 border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-900 sm:text-sm"
        >
          <option value="">All categories</option>
          {SUPPORT_CATEGORIES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
          <option value="billing">Billing</option>
        </select>
      </div>

      <div className="overflow-hidden border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          Open an issue to read the conversation and reply.
        </div>
        {reports.isPending ? (
          <p role="status" className="p-6 text-sm">
            Loading issues...
          </p>
        ) : reports.isError ? (
          <div role="alert" className="space-y-3 p-6 text-sm">
            <p>{reports.error.message}</p>
            <button
              type="button"
              onClick={() => reports.refetch()}
              className="min-h-11 border border-current px-4 font-bold"
            >
              Try again
            </button>
          </div>
        ) : reports.data.length === 0 ? (
          <p className="p-6 text-sm text-zinc-500">No issues match these filters.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {reports.data.map((issue) => {
              const closed = issue.status === "resolved" || issue.status === "closed"
              const StatusIcon = closed ? CheckCircle2 : CircleDot
              return (
                <li key={issue.id}>
                  <Link
                    href={`/support/issues/${issue.id}?admin=1`}
                    className="flex min-w-0 items-start gap-3 px-4 py-4 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#ff4e26] dark:hover:bg-zinc-800/60"
                  >
                    <StatusIcon
                      size={19}
                      aria-label={closed ? "Closed" : "Open"}
                      className={`mt-0.5 shrink-0 ${closed ? "text-zinc-500" : "text-[#ff4e26]"}`}
                    />
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className="line-clamp-2 break-words text-sm font-bold sm:text-base">
                        {issue.title || issue.message}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                        <span className="max-w-full break-all">
                          {issue.email_override || issue.user_email || issue.user_name || "Guest"}
                        </span>
                        <time dateTime={issue.created_at}>
                          {new Date(issue.created_at).toLocaleDateString()}
                        </time>
                        <span className="border border-zinc-300 px-1.5 py-0.5 dark:border-zinc-600">
                          {getCategoryLabel(issue.category)}
                        </span>
                        <span>
                          {closed
                            ? "Closed"
                            : issue.status === "in_progress"
                              ? "In progress"
                              : "Open"}
                        </span>
                        {issue.attachment_count > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Paperclip size={12} aria-hidden="true" />
                            {issue.attachment_count}
                            <span className="sr-only"> attachments</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {reports.data && reports.data.length === limit && limit < 200 && (
        <button
          type="button"
          onClick={() => setLimit((current) => Math.min(current + 50, 200))}
          className="min-h-11 border border-current px-4 text-sm font-bold"
        >
          Load more issues
        </button>
      )}
    </section>
  )
}
