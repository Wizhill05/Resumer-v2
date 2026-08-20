"use client"

import React, { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Star,
  Search,
  Volume2,
  Image as ImageIcon,
  RefreshCw,
  X,
  ExternalLink,
} from "lucide-react"
import { useDebouncedValue } from "../useDebouncedValue"
import {
  FeedbackAnalytics,
  SupportReportItem,
  FeedbackRatingItem,
  SupportReportDetail,
} from "../types"

interface AdminFeedbackTabProps {
  onInspectGenerationById?: (id: string) => void
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText)
    throw new Error(errText || `Request failed: ${res.status}`)
  }
  return res.json()
}

export function AdminFeedbackTab({ onInspectGenerationById }: AdminFeedbackTabProps) {
  const queryClient = useQueryClient()
  const [subTab, setSubTab] = useState<"reports" | "ratings">("reports")
  const [statusFilter, setStatusFilter] = useState<string>("")
  const [searchInput, setSearchInput] = useState<string>("")
  const debouncedSearch = useDebouncedValue(searchInput, 300)
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)

  // 1. Fetch Feedback Analytics
  const { data: analytics } = useQuery<FeedbackAnalytics>({
    queryKey: ["admin-feedback-analytics"],
    queryFn: () => fetchJson<FeedbackAnalytics>("/api/backend/admin/feedback/analytics"),
  })

  // 2. Fetch Support Reports
  const { data: reports = [], isLoading: loadingReports, isFetching, refetch: refetchReports } = useQuery<SupportReportItem[]>({
    queryKey: ["admin-support-reports", statusFilter, debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams()
      if (statusFilter) params.set("status", statusFilter)
      if (debouncedSearch) params.set("search", debouncedSearch)
      return fetchJson<SupportReportItem[]>(`/api/backend/admin/feedback/reports?${params.toString()}`)
    },
    enabled: subTab === "reports",
  })

  // 3. Fetch User Ratings
  const { data: ratings = [], isLoading: loadingRatings } = useQuery<FeedbackRatingItem[]>({
    queryKey: ["admin-feedback-ratings"],
    queryFn: () => fetchJson<FeedbackRatingItem[]>("/api/backend/admin/feedback/ratings?limit=100"),
    enabled: subTab === "ratings",
  })

  // 4. Fetch Selected Report Detail
  const { data: reportDetail, isLoading: loadingDetail } = useQuery<SupportReportDetail>({
    queryKey: ["admin-report-detail", selectedReportId],
    queryFn: () => fetchJson<SupportReportDetail>(`/api/backend/admin/feedback/reports/${selectedReportId}`),
    enabled: !!selectedReportId,
  })

  // Update report status mutation
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status, adminNotes }: { id: string; status: string; adminNotes?: string }) => {
      return fetchJson(`/api/backend/admin/feedback/reports/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, admin_notes: adminNotes }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-support-reports"] })
      queryClient.invalidateQueries({ queryKey: ["admin-report-detail", selectedReportId] })
      queryClient.invalidateQueries({ queryKey: ["admin-feedback-analytics"] })
    },
    onError: (err: Error) => {
      alert(`Status update failed: ${err.message}`)
    },
  })

  return (
    <div className="space-y-6">
      {/* Analytics Summary Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 font-mono text-xs">
        <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 border-l-4 border-blue-500 shadow-[2px_2px_0px_#000000]">
          <span className="text-zinc-500 text-[10px] uppercase font-bold block">Total Reports</span>
          <span className="text-xl font-black text-zinc-900 dark:text-white mt-1 block">
            {analytics?.total_reports ?? 0}
          </span>
          <span className="text-[10px] text-zinc-400 mt-1 block">User feedback tickets</span>
        </div>

        <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 border-l-4 border-red-500 shadow-[2px_2px_0px_#000000]">
          <span className="text-zinc-500 text-[10px] uppercase font-bold block">Open Tickets</span>
          <span className="text-xl font-black text-red-500 mt-1 block">
            {analytics?.open_reports ?? 0}
          </span>
          <span className="text-[10px] text-zinc-400 mt-1 block">Awaiting resolution</span>
        </div>

        <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 border-l-4 border-emerald-500 shadow-[2px_2px_0px_#000000]">
          <span className="text-zinc-500 text-[10px] uppercase font-bold block">Resolved</span>
          <span className="text-xl font-black text-emerald-500 mt-1 block">
            {analytics?.resolved_reports ?? 0}
          </span>
          <span className="text-[10px] text-zinc-400 mt-1 block">Successfully handled</span>
        </div>

        <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 border-l-4 border-amber-500 shadow-[2px_2px_0px_#000000]">
          <span className="text-zinc-500 text-[10px] uppercase font-bold block">Avg User Rating</span>
          <span className="text-xl font-black text-amber-400 mt-1 flex items-center gap-1">
            <Star size={16} className="fill-amber-400 text-amber-400" />
            {analytics?.average_star_rating ? analytics.average_star_rating.toFixed(2) : "-"}
          </span>
          <span className="text-[10px] text-zinc-400 mt-1 block">
            From {analytics?.total_ratings ?? 0} reviews
          </span>
        </div>
      </div>

      {/* Sub-tab Navigation */}
      <div className="flex border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-1 font-mono text-xs">
        <button
          type="button"
          onClick={() => setSubTab("reports")}
          className={`px-4 py-2 font-bold uppercase transition-all ${
            subTab === "reports"
              ? "bg-[#ff4e26] text-white shadow-[2px_2px_0px_#000000]"
              : "text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
          }`}
        >
          Support Reports &amp; Bug Tickets
        </button>
        <button
          type="button"
          onClick={() => setSubTab("ratings")}
          className={`px-4 py-2 font-bold uppercase transition-all ${
            subTab === "ratings"
              ? "bg-[#ff4e26] text-white shadow-[2px_2px_0px_#000000]"
              : "text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
          }`}
        >
          User Star Ratings &amp; Reviews
        </button>
      </div>

      {/* SUB-TAB 1: SUPPORT REPORTS */}
      {subTab === "reports" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Reports List */}
          <div className="lg:col-span-2 space-y-4">
            {/* Filter Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-[2px_2px_0px_#000000]">
              <div className="relative flex-1 max-w-md">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search report text, user email..."
                  className="h-9 w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 pl-9 pr-3 text-xs font-mono text-zinc-900 dark:text-white placeholder-zinc-400 focus:border-[#ff4e26] focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2 font-mono text-xs">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-9 border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-2 text-xs font-mono text-zinc-900 dark:text-white focus:border-[#ff4e26] focus:outline-none"
                >
                  <option value="">All Statuses</option>
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>

                <button
                  type="button"
                  onClick={() => refetchReports()}
                  disabled={isFetching}
                  className="flex h-9 items-center gap-1 border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-3 font-bold uppercase text-zinc-800 dark:text-zinc-200 hover:border-[#ff4e26] disabled:opacity-50"
                >
                  <RefreshCw size={12} className={isFetching ? "animate-spin text-[#ff4e26]" : ""} />
                </button>
              </div>
            </div>

            {/* Reports Cards */}
            <div className="space-y-3">
              {loadingReports ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((n) => (
                    <div key={n} className="h-20 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 animate-pulse" />
                  ))}
                </div>
              ) : reports.length === 0 ? (
                <div className="border border-dashed border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-12 text-center font-mono text-xs text-zinc-500">
                  No support tickets found matching current filters.
                </div>
              ) : (
                reports.map((rep) => {
                  const isSelected = rep.id === selectedReportId
                  return (
                    <div
                      key={rep.id}
                      onClick={() => setSelectedReportId(rep.id)}
                      className={`cursor-pointer border p-4 font-mono text-xs shadow-[2px_2px_0px_#000000] transition-all ${
                        isSelected
                          ? "border-[#ff4e26] bg-zinc-100 dark:bg-zinc-800"
                          : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-400"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-zinc-900 dark:text-white uppercase">
                            [{rep.category}]
                          </span>
                          <span className="text-zinc-500 text-[11px]">
                            {rep.email || "Anonymous"}
                          </span>
                        </div>
                        <span
                          className={`px-1.5 py-0.5 text-[10px] font-bold uppercase border ${
                            rep.status === "resolved"
                              ? "border-emerald-800 bg-emerald-950 text-emerald-400"
                              : rep.status === "in_progress"
                              ? "border-amber-800 bg-amber-950 text-amber-400"
                              : "border-red-800 bg-red-950 text-red-400"
                          }`}
                        >
                          {rep.status}
                        </span>
                      </div>

                      <p className="mt-2 text-zinc-700 dark:text-zinc-300 font-sans text-xs line-clamp-2">
                        {rep.message}
                      </p>

                      <div className="mt-3 flex items-center justify-between border-t border-zinc-100 dark:border-zinc-800/80 pt-2 text-[11px] text-zinc-400">
                        <div className="flex items-center gap-3">
                          {rep.has_voice && (
                            <span className="flex items-center gap-1 text-purple-400 font-bold">
                              <Volume2 size={12} />
                              Voice Note
                            </span>
                          )}
                          {rep.attachment_count > 0 && (
                            <span className="flex items-center gap-1 text-blue-400 font-bold">
                              <ImageIcon size={12} />
                              {rep.attachment_count} File{rep.attachment_count === 1 ? "" : "s"}
                            </span>
                          )}
                          {/* Safe Sentiment check fixing grilling audit bug */}
                          {rep.sentiment_score != null && (
                            <span className="text-[#ff4e26] font-bold">
                              Sentiment: {rep.sentiment_score}/10
                            </span>
                          )}
                        </div>

                        <span>{new Date(rep.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Report Detail Sidebar */}
          <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-[2px_2px_0px_#000000] font-mono text-xs space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-white">
                Ticket Details
              </h3>
              {selectedReportId && (
                <button
                  type="button"
                  onClick={() => setSelectedReportId(null)}
                  className="text-zinc-400 hover:text-white"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {!selectedReportId ? (
              <div className="p-8 text-center text-zinc-500">
                Select a support ticket on the left to inspect full messages, screenshots, voice notes, and change resolution status.
              </div>
            ) : loadingDetail || !reportDetail ? (
              <div className="h-48 border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 animate-pulse" />
            ) : (
              <div className="space-y-4">
                <div>
                  <span className="text-[10px] text-zinc-500 uppercase font-bold block">Status Control</span>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {["open", "in_progress", "resolved", "closed"].map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => updateStatusMutation.mutate({ id: reportDetail.id, status: st })}
                        className={`px-2.5 py-1 text-[10px] font-bold uppercase border transition-colors ${
                          reportDetail.status === st
                            ? "bg-[#ff4e26] text-white border-white"
                            : "border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:border-zinc-500"
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] text-zinc-500 uppercase font-bold block">Full Message</span>
                  <div className="mt-1 p-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200 font-sans text-xs whitespace-pre-wrap">
                    {reportDetail.message}
                  </div>
                </div>

                {reportDetail.generation_id && (
                  <div>
                    <span className="text-[10px] text-zinc-500 uppercase font-bold block">Linked Generation</span>
                    <button
                      type="button"
                      onClick={() => onInspectGenerationById?.(reportDetail.generation_id!)}
                      className="mt-1 flex items-center gap-1.5 text-[#ff4e26] font-bold hover:underline"
                    >
                      <span>Inspect Generation {reportDetail.generation_id.slice(0, 8)}...</span>
                      <ExternalLink size={12} />
                    </button>
                  </div>
                )}

                {reportDetail.attachments && reportDetail.attachments.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-[10px] text-zinc-500 uppercase font-bold block">Attachments</span>
                    {reportDetail.attachments.map((att) => (
                      <div key={att.id} className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-2 space-y-1">
                        <span className="text-[11px] font-bold text-zinc-700 dark:text-zinc-300 truncate block">
                          {att.file_name} ({att.file_type})
                        </span>
                        {att.file_type === "voice" && att.file_url && (
                          <audio controls src={att.file_url} className="w-full h-8 mt-1" />
                        )}
                        {att.file_type === "image" && att.file_url && (
                          <a href={att.file_url} target="_blank" rel="noreferrer" className="block mt-1">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={att.file_url} alt={att.file_name} className="max-h-48 w-auto border border-zinc-700" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 2: USER RATINGS */}
      {subTab === "ratings" && (
        <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-[2px_2px_0px_#000000] overflow-hidden">
          <div className="overflow-x-auto">
            {loadingRatings ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="h-12 border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 animate-pulse" />
                ))}
              </div>
            ) : ratings.length === 0 ? (
              <div className="p-12 text-center font-mono text-xs text-zinc-500">
                No user rating reviews recorded yet.
              </div>
            ) : (
              <table className="w-full text-left font-mono text-xs">
                <thead className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-[11px] text-zinc-500 uppercase">
                  <tr>
                    <th className="py-3 px-4">Rating</th>
                    <th className="py-3 px-4">User</th>
                    <th className="py-3 px-4">Comment</th>
                    <th className="py-3 px-4">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                  {ratings.map((r) => (
                    <tr key={r.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1 text-amber-400 font-bold">
                          {Array.from({ length: 5 }).map((_, idx) => (
                            <Star
                              key={idx}
                              size={12}
                              className={idx < r.star_rating ? "fill-amber-400 text-amber-400" : "text-zinc-600"}
                            />
                          ))}
                          <span className="ml-1 text-zinc-900 dark:text-white">{r.star_rating}/5</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-zinc-600 dark:text-zinc-300">
                        {r.email || r.user_id.slice(0, 8)}
                      </td>
                      <td className="py-3 px-4 font-sans text-zinc-800 dark:text-zinc-200">
                        {r.comment || <span className="text-zinc-500 italic">No text comment provided</span>}
                      </td>
                      <td className="py-3 px-4 text-zinc-500 text-[11px]">
                        {new Date(r.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
