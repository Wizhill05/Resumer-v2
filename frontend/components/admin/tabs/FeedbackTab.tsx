"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { MessageSquare, Star } from "lucide-react"
import { cn } from "@/lib/utils"
import { AdminIssueInbox } from "../AdminIssueInbox"
import type { FeedbackAnalytics, FeedbackRatingItem } from "../api-types"
import { Note, Panel, Skeleton, Stat, fetchJson } from "../shared"

export function FeedbackTab() {
  const [sub, setSub] = useState<"reports" | "ratings">("reports")
  const { data: analytics } = useQuery<FeedbackAnalytics>({
    queryKey: ["admin", "feedback", "analytics"],
    queryFn: () => fetchJson<FeedbackAnalytics>("/api/backend/admin/feedback/analytics"),
    staleTime: 30000,
  })
  const { data: ratings = [], isLoading, isError } = useQuery<FeedbackRatingItem[]>({
    queryKey: ["admin", "feedback", "ratings"],
    queryFn: () => fetchJson<FeedbackRatingItem[]>("/api/backend/admin/feedback/ratings?limit=50"),
    enabled: sub === "ratings",
  })

  const tab = (id: "reports" | "ratings", label: string, icon: React.ReactNode) => (
    <button
      type="button"
      aria-pressed={sub === id}
      onClick={() => setSub(id)}
      className={cn(
        "flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 border px-4 text-xs font-bold sm:flex-none",
        sub === id ? "border-[#ff4e26] bg-[#ff4e26] text-white" : "border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
      )}
    >
      {icon} {label}
    </button>
  )

  return (
    <div className="space-y-5 pixel-enter">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total reports" value={analytics?.total_reports ?? 0} />
        <Stat label="Open tickets" value={analytics?.open_count ?? 0} accent />
        <Stat label="Average rating" value={<span className="text-amber-600 dark:text-amber-400">{analytics?.avg_rating ?? "N/A"}</span>} />
        <Stat label="Total reviews" value={analytics?.total_ratings ?? 0} />
      </div>

      <div className="flex gap-2 border-b border-zinc-200 pb-3 dark:border-zinc-700">
        {tab("reports", "Issues", <MessageSquare size={14} />)}
        {tab("ratings", "Ratings", <Star size={14} />)}
      </div>

      {sub === "reports" && <AdminIssueInbox />}
      {sub === "ratings" && (
        <Panel className="p-0 sm:p-0">
          {isLoading ? (
            <Skeleton className="h-32 border-0" />
          ) : isError ? (
            <div className="p-4"><Note tone="error">Ratings could not be loaded. Use Refresh to try again.</Note></div>
          ) : ratings.length === 0 ? (
            <p className="p-8 text-center text-xs text-zinc-500">No ratings submitted yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {ratings.map((rating) => (
                <li key={rating.id} className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="break-all font-bold">{rating.user_email || rating.user_name || "User"}</span>
                    <time dateTime={rating.created_at} className="text-zinc-500">{new Date(rating.created_at).toLocaleDateString()}</time>
                  </div>
                  <div className="flex items-center gap-1" role="img" aria-label={`${rating.star_rating} out of 5 stars`}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star key={star} size={16} aria-hidden="true" className={star <= rating.star_rating ? "fill-amber-400 text-amber-600" : "text-zinc-300 dark:text-zinc-700"} />
                    ))}
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">{rating.comment || "No comment left"}</p>
                  {rating.generation_job_title && <p className="break-words text-xs text-zinc-500">{rating.generation_job_title}</p>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </div>
  )
}
