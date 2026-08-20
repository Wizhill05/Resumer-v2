"use client"

import React, { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Search,
  Filter,
  Terminal,
  Trash2,
  RefreshCw,
  X,
} from "lucide-react"
import { useDebouncedValue } from "../useDebouncedValue"
import { GenerationItem } from "../types"

interface AdminGenerationsTabProps {
  onInspectGeneration: (gen: GenerationItem) => void
  initialSearch?: string
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Fetch failed: ${res.statusText}`)
  return res.json()
}

export function AdminGenerationsTab({
  onInspectGeneration,
  initialSearch = "",
}: AdminGenerationsTabProps) {
  const queryClient = useQueryClient()
  const [searchInput, setSearchInput] = useState(initialSearch)
  const debouncedSearch = useDebouncedValue(searchInput, 300)
  const [statusFilter, setStatusFilter] = useState("")

  const { data: generations = [], isLoading, isFetching, refetch } = useQuery<GenerationItem[]>({
    queryKey: ["admin-generations", debouncedSearch, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams()
      if (debouncedSearch) params.set("search", debouncedSearch)
      if (statusFilter) params.set("status", statusFilter)
      params.set("limit", "100")
      return fetchJson<GenerationItem[]>(`/api/backend/admin/generations?${params.toString()}`)
    },
  })

  const deleteGenMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/backend/admin/generations/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Delete failed")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-generations"] })
      queryClient.invalidateQueries({ queryKey: ["admin-analytics"] })
    },
  })

  return (
    <div className="space-y-4">
      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-[2px_2px_0px_#000000]">
        <div className="flex flex-1 items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by job title, email, generation ID, template..."
              className="h-9 w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 pl-9 pr-8 text-xs font-mono text-zinc-900 dark:text-white placeholder-zinc-400 focus:border-[#ff4e26] focus:outline-none"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 font-mono text-xs">
            <Filter size={13} className="text-zinc-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-2 text-xs font-mono text-zinc-900 dark:text-white focus:border-[#ff4e26] focus:outline-none"
            >
              <option value="">All Statuses</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="generating">Generating</option>
              <option value="pending">Pending</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-3 font-mono text-xs">
          <span className="text-zinc-500">
            {generations.length} record{generations.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1 border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 font-bold uppercase text-zinc-800 dark:text-zinc-200 hover:border-[#ff4e26] transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={isFetching ? "animate-spin text-[#ff4e26]" : ""} />
            <span>Reload</span>
          </button>
        </div>
      </div>

      {/* Generations Table */}
      <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-[2px_2px_0px_#000000] overflow-hidden">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map((n) => (
                <div key={n} className="h-12 border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 animate-pulse" />
              ))}
            </div>
          ) : generations.length === 0 ? (
            <div className="p-12 text-center font-mono text-xs text-zinc-500">
              No generations matched the current filter criteria.
            </div>
          ) : (
            <table className="w-full text-left font-mono text-xs">
              <thead className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-[11px] text-zinc-500 uppercase">
                <tr>
                  <th className="py-3 px-4">Target / Company</th>
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-4">Model &amp; Template</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4">Created</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {generations.map((gen) => {
                  const isSuccess = gen.status === "completed"
                  const isFailed = gen.status === "failed"
                  return (
                    <tr key={gen.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-bold text-zinc-900 dark:text-white truncate max-w-[220px]">
                          {gen.job_title || gen.company || "General Resume"}
                        </div>
                        <div className="text-[10px] text-zinc-400 font-mono">
                          ID: {gen.id.slice(0, 8)}...
                        </div>
                      </td>
                      <td className="py-3 px-4 text-zinc-700 dark:text-zinc-300">
                        <div className="truncate max-w-[180px]">
                          {gen.email || (gen.is_guest ? "Guest (Unregistered)" : gen.user_id.slice(0, 8))}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-zinc-600 dark:text-zinc-400">
                        <div className="truncate max-w-[150px] text-zinc-900 dark:text-zinc-200 font-semibold" title={gen.model_used}>
                          {gen.model_used.split("/").pop()}
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          Template: {gen.template_id}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 text-[10px] font-bold uppercase border ${
                            isSuccess
                              ? "border-emerald-800 bg-emerald-950 text-emerald-400"
                              : isFailed
                              ? "border-red-800 bg-red-950 text-red-400"
                              : "border-amber-800 bg-amber-950 text-amber-400"
                          }`}
                        >
                          {gen.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-zinc-800 dark:text-zinc-200">
                        {gen.duration_seconds != null ? `${gen.duration_seconds.toFixed(1)}s` : "-"}
                      </td>
                      <td className="py-3 px-4 text-zinc-500 text-[11px]">
                        {new Date(gen.created_at).toLocaleDateString()} {new Date(gen.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => onInspectGeneration(gen)}
                            className="inline-flex items-center gap-1 border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 text-xs font-bold text-zinc-900 dark:text-white hover:border-[#ff4e26] hover:text-[#ff4e26] transition-colors"
                            title="Inspect Timeline & Logs"
                          >
                            <Terminal size={12} />
                            <span>Trace</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`Delete generation record ${gen.id}?`)) {
                                deleteGenMutation.mutate(gen.id)
                              }
                            }}
                            className="inline-flex items-center justify-center h-7 w-7 border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:border-red-600 hover:text-red-500 transition-colors"
                            title="Delete Record"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
