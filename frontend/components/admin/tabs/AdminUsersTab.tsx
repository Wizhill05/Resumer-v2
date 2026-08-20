"use client"

import React, { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Search,
  Sliders,
  RotateCcw,
  Star,
  X,
  RefreshCw,
  Save,
} from "lucide-react"
import { useDebouncedValue } from "../useDebouncedValue"
import { UserItem } from "../types"

interface CapModalState {
  isOpen: boolean
  user: UserItem | null
  dailyCap: number
  monthlyCap: number
  adminNote: string
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText)
    throw new Error(errText || `Request failed: ${res.status}`)
  }
  return res.json()
}

export function AdminUsersTab() {
  const queryClient = useQueryClient()
  const [searchInput, setSearchInput] = useState("")
  const debouncedSearch = useDebouncedValue(searchInput, 300)

  // Safe Cap Modal state (fixes window.prompt null-to-zero bug)
  const [capModal, setCapModal] = useState<CapModalState>({
    isOpen: false,
    user: null,
    dailyCap: 5,
    monthlyCap: 50,
    adminNote: "",
  })

  // 1. Fetch Users List
  const { data: users = [], isLoading, isFetching, refetch } = useQuery<UserItem[]>({
    queryKey: ["admin-users", debouncedSearch],
    queryFn: () => {
      const url = debouncedSearch
        ? `/api/backend/admin/users?search=${encodeURIComponent(debouncedSearch)}`
        : "/api/backend/admin/users?limit=100"
      return fetchJson<UserItem[]>(url)
    },
  })

  // 2. Toggle Pro Tier
  const toggleProMutation = useMutation({
    mutationFn: async ({ userId, isPro }: { userId: string; isPro: boolean }) => {
      return fetchJson(`/api/backend/admin/users/${userId}/tier`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_pro: isPro }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] })
    },
    onError: (err: Error) => {
      alert(`Tier update failed: ${err.message}`)
    },
  })

  // 3. Reset Request Count
  const resetCountMutation = useMutation({
    mutationFn: async (userId: string) => {
      return fetchJson(`/api/backend/admin/users/${userId}/rate-limit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_count: 0 }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] })
      alert("User request counter reset to 0.")
    },
    onError: (err: Error) => {
      alert(`Reset failed: ${err.message}`)
    },
  })

  // 4. Save Cap Overrides
  const saveCapMutation = useMutation({
    mutationFn: async () => {
      if (!capModal.user) return
      return fetchJson(`/api/backend/admin/users/${capModal.user.id}/credit-override`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daily_cap: capModal.dailyCap,
          monthly_cap: capModal.monthlyCap,
          admin_note: capModal.adminNote || null,
        }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] })
      setCapModal((prev) => ({ ...prev, isOpen: false }))
      alert("Rate limit caps and notes updated successfully.")
    },
    onError: (err: Error) => {
      alert(`Save caps failed: ${err.message}`)
    },
  })

  const openCapDialog = (user: UserItem) => {
    setCapModal({
      isOpen: true,
      user,
      dailyCap: user.daily_cap ?? 5,
      monthlyCap: user.monthly_cap ?? 50,
      adminNote: user.admin_note || "",
    })
  }

  return (
    <div className="space-y-4">
      {/* Search & Header Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-[2px_2px_0px_#000000]">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search accounts by email address..."
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

        <div className="flex items-center justify-between sm:justify-end gap-3 font-mono text-xs">
          <span className="text-zinc-500">{users.length} accounts found</span>
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

      {/* Users Table */}
      <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-[2px_2px_0px_#000000] overflow-hidden">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map((n) => (
                <div key={n} className="h-12 border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 animate-pulse" />
              ))}
            </div>
          ) : users.length === 0 ? (
            <div className="p-12 text-center font-mono text-xs text-zinc-500">
              No user accounts found matching your search query.
            </div>
          ) : (
            <table className="w-full text-left font-mono text-xs">
              <thead className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-[11px] text-zinc-500 uppercase">
                <tr>
                  <th className="py-3 px-4">User Account</th>
                  <th className="py-3 px-4">Plan / Tier</th>
                  <th className="py-3 px-4">Daily Usage</th>
                  <th className="py-3 px-4">Monthly Usage</th>
                  <th className="py-3 px-4">Admin Notes</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {users.map((u) => {
                  const dailyCap = u.daily_cap ?? 5
                  const monthlyCap = u.monthly_cap ?? 50
                  const isDailyExceeded = u.request_count >= dailyCap
                  return (
                    <tr key={u.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-bold text-zinc-900 dark:text-white truncate max-w-[240px]">
                          {u.email}
                        </div>
                        <div className="text-[10px] text-zinc-400 font-mono">
                          Provider: {u.provider || "email"} &bull; Joined: {new Date(u.created_at).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => toggleProMutation.mutate({ userId: u.id, isPro: !u.is_pro })}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase border transition-colors ${
                            u.is_pro
                              ? "border-emerald-800 bg-emerald-950 text-emerald-300 hover:bg-emerald-900"
                              : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                          }`}
                          title="Click to toggle Pro tier"
                        >
                          <Star size={10} className={u.is_pro ? "fill-emerald-400 text-emerald-400" : ""} />
                          <span>{u.is_pro ? "Pro Plan" : "Free Plan"}</span>
                        </button>
                      </td>
                      <td className="py-3 px-4">
                        <span className={isDailyExceeded ? "font-bold text-red-500" : "text-zinc-800 dark:text-zinc-200"}>
                          {u.request_count} / {dailyCap}
                        </span>
                        {isDailyExceeded && (
                          <span className="ml-1.5 text-[9px] bg-red-950 border border-red-800 text-red-400 px-1 py-0.2 uppercase font-bold">
                            Capped
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-zinc-700 dark:text-zinc-300">
                        {u.monthly_count ?? 0} / {monthlyCap}
                      </td>
                      <td className="py-3 px-4 text-zinc-500 text-[11px] truncate max-w-[160px]" title={u.admin_note}>
                        {u.admin_note || "-"}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openCapDialog(u)}
                            className="inline-flex items-center gap-1 border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 text-xs font-bold text-zinc-900 dark:text-white hover:border-[#ff4e26] hover:text-[#ff4e26] transition-colors"
                            title="Adjust Rate Limit Caps & Notes"
                          >
                            <Sliders size={12} />
                            <span>Caps</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => resetCountMutation.mutate(u.id)}
                            className="inline-flex items-center justify-center h-7 w-7 border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:border-black dark:hover:border-white hover:text-black dark:hover:text-white transition-colors"
                            title="Reset Daily Count to 0"
                          >
                            <RotateCcw size={12} />
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

      {/* SAFE CAP OVERRIDE MODAL */}
      {capModal.isOpen && capModal.user && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-md border border-zinc-800 bg-zinc-950 p-6 text-white shadow-2xl space-y-4 font-mono text-xs">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <span className="text-[10px] font-bold text-[#ff4e26] uppercase">Account Limit Override</span>
                <h3 className="text-sm font-extrabold uppercase text-white truncate max-w-[300px]">
                  {capModal.user.email}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCapModal((prev) => ({ ...prev, isOpen: false }))}
                className="text-zinc-400 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-zinc-400 font-bold uppercase mb-1">
                  Daily Generation Limit (Cap)
                </label>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={capModal.dailyCap}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10)
                    setCapModal((prev) => ({ ...prev, dailyCap: isNaN(n) ? 5 : n }))
                  }}
                  className="h-9 w-full border border-zinc-700 bg-zinc-900 px-3 text-xs text-white focus:border-[#ff4e26] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-zinc-400 font-bold uppercase mb-1">
                  Monthly Generation Limit (Cap)
                </label>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={capModal.monthlyCap}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10)
                    setCapModal((prev) => ({ ...prev, monthlyCap: isNaN(n) ? 50 : n }))
                  }}
                  className="h-9 w-full border border-zinc-700 bg-zinc-900 px-3 text-xs text-white focus:border-[#ff4e26] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-zinc-400 font-bold uppercase mb-1">
                  Admin Notes / Remarks
                </label>
                <textarea
                  rows={3}
                  value={capModal.adminNote}
                  onChange={(e) => setCapModal((prev) => ({ ...prev, adminNote: e.target.value }))}
                  placeholder="e.g. VIP Enterprise tester, granted extended quota."
                  className="w-full border border-zinc-700 bg-zinc-900 p-2.5 text-xs text-white focus:border-[#ff4e26] focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-zinc-800 pt-3">
              <button
                type="button"
                onClick={() => setCapModal((prev) => ({ ...prev, isOpen: false }))}
                className="border border-zinc-700 bg-zinc-900 px-3 py-1.5 font-bold uppercase text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => saveCapMutation.mutate()}
                disabled={saveCapMutation.isPending}
                className="flex items-center gap-1.5 border border-white bg-[#ff4e26] px-4 py-1.5 font-bold uppercase text-white shadow-[2px_2px_0px_#000000] hover:bg-[#e03d16] disabled:opacity-50"
              >
                <Save size={13} />
                <span>{saveCapMutation.isPending ? "Saving..." : "Save Changes"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
