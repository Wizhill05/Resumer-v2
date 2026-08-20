"use client"

import React, { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Search,
  Trash2,
  ChevronRight,
  ChevronLeft,
  RefreshCw,
} from "lucide-react"
import { StorageList } from "../types"

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText)
    throw new Error(errText || `Request failed: ${res.status}`)
  }
  return res.json()
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes"
  const k = 1024
  const sizes = ["Bytes", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

export function AdminStorageTab() {
  const queryClient = useQueryClient()
  const [prefixInput, setPrefixInput] = useState("")
  const [activePrefix, setActivePrefix] = useState("")
  const [cursorHistory, setCursorHistory] = useState<string[]>([])
  const [currentCursor, setCurrentCursor] = useState<string | undefined>(undefined)

  const { data: storageData, isLoading, isFetching, refetch } = useQuery<StorageList>({
    queryKey: ["admin-storage", activePrefix, currentCursor],
    queryFn: () => {
      const params = new URLSearchParams()
      if (activePrefix) params.set("prefix", activePrefix)
      if (currentCursor) params.set("cursor", currentCursor)
      return fetchJson<StorageList>(`/api/backend/admin/storage/objects?${params.toString()}`)
    },
  })

  // Delete single object mutation
  const deleteObjectMutation = useMutation({
    mutationFn: async (key: string) => {
      return fetchJson("/api/backend/admin/storage/object", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-storage"] })
      alert("Storage object deleted successfully.")
    },
    onError: (err: Error) => {
      alert(`Delete failed: ${err.message}`)
    },
  })

  const objects = storageData?.objects || []
  const nextCursor = storageData?.next_cursor

  const handleNextPage = () => {
    if (nextCursor) {
      setCursorHistory((prev) => [...prev, currentCursor || ""])
      setCurrentCursor(nextCursor)
    }
  }

  const handlePrevPage = () => {
    if (cursorHistory.length > 0) {
      const prev = cursorHistory[cursorHistory.length - 1]
      setCursorHistory((h) => h.slice(0, -1))
      setCurrentCursor(prev || undefined)
    }
  }

  const handleApplyPrefix = (e: React.FormEvent) => {
    e.preventDefault()
    setActivePrefix(prefixInput)
    setCurrentCursor(undefined)
    setCursorHistory([])
  }

  return (
    <div className="space-y-4">
      {/* Header & Prefix Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-[2px_2px_0px_#000000]">
        <form onSubmit={handleApplyPrefix} className="flex flex-1 items-center gap-2 max-w-md">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={prefixInput}
              onChange={(e) => setPrefixInput(e.target.value)}
              placeholder="Filter by prefix (e.g. resumes/, avatars/)..."
              className="h-9 w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 pl-9 pr-3 text-xs font-mono text-zinc-900 dark:text-white placeholder-zinc-400 focus:border-[#ff4e26] focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="h-9 border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-3 font-mono text-xs font-bold uppercase text-zinc-800 dark:text-zinc-200 hover:border-[#ff4e26] transition-colors"
          >
            Apply
          </button>
        </form>

        <div className="flex items-center justify-between sm:justify-end gap-3 font-mono text-xs">
          <span className="text-zinc-500">
            {objects.length} object{objects.length === 1 ? "" : "s"} on page
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

      {/* Storage Objects Table */}
      <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-[2px_2px_0px_#000000] overflow-hidden">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map((n) => (
                <div key={n} className="h-12 border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 animate-pulse" />
              ))}
            </div>
          ) : objects.length === 0 ? (
            <div className="p-12 text-center font-mono text-xs text-zinc-500">
              No storage objects found under the specified prefix.
            </div>
          ) : (
            <table className="w-full text-left font-mono text-xs">
              <thead className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-[11px] text-zinc-500 uppercase">
                <tr>
                  <th className="py-3 px-4">Storage Key / Path</th>
                  <th className="py-3 px-4">Size</th>
                  <th className="py-3 px-4">Last Modified</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {objects.map((obj) => (
                  <tr key={obj.key} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-bold text-zinc-900 dark:text-white truncate max-w-[420px]" title={obj.key}>
                        {obj.key}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-zinc-700 dark:text-zinc-300 font-semibold">
                      {formatBytes(obj.size)}
                    </td>
                    <td className="py-3 px-4 text-zinc-500 text-[11px]">
                      {obj.last_modified ? new Date(obj.last_modified).toLocaleString() : "-"}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`Delete storage object "${obj.key}"?`)) {
                              deleteObjectMutation.mutate(obj.key)
                            }
                          }}
                          className="inline-flex items-center justify-center h-7 w-7 border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:border-red-600 hover:text-red-500 transition-colors"
                          title="Delete Object"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Cursor Pagination Bar (Solving finding from grilling audit) */}
        <div className="flex items-center justify-between border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-4 py-3 font-mono text-xs">
          <button
            type="button"
            onClick={handlePrevPage}
            disabled={cursorHistory.length === 0}
            className="flex items-center gap-1 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 font-bold uppercase text-zinc-800 dark:text-zinc-200 hover:border-[#ff4e26] transition-colors disabled:opacity-40"
          >
            <ChevronLeft size={14} />
            <span>Previous Page</span>
          </button>

          <span className="text-zinc-500 text-[11px]">
            Page {cursorHistory.length + 1} {currentCursor ? `(Cursor: ${currentCursor.slice(0, 8)}...)` : ""}
          </span>

          <button
            type="button"
            onClick={handleNextPage}
            disabled={!nextCursor}
            className="flex items-center gap-1 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 font-bold uppercase text-zinc-800 dark:text-zinc-200 hover:border-[#ff4e26] transition-colors disabled:opacity-40"
          >
            <span>Next Page</span>
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
