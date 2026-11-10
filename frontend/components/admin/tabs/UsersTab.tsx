"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { UserItem } from "../api-types"
import { FIELD_CLASS, Note, Pill, Skeleton, fetchJson, sendJson } from "../shared"
import { DeletionOverlay, DeletionPill, PendingDeletionsPanel } from "../PendingDeletions"

type UserActions = {
  editingId: string | null
  draft: number
  setDraft: (value: number) => void
  setEditingId: (id: string | null) => void
  saveCount: (userId: string, count: number) => void
  saving: boolean
  toggleTier: (user: UserItem) => void
  editCaps: (user: UserItem) => void
}

function TierPill({ user }: { user: UserItem }) {
  return user.is_pro ? <Pill tone="good">★ Pro</Pill> : <Pill>Free</Pill>
}

function UsageEditor({ user, actions }: { user: UserItem; actions: UserActions }) {
  if (user.is_admin) return <span className="font-mono text-zinc-500" title="Admins skip the daily cap">No cap</span>
  if (actions.editingId !== user.id) return <span className="font-mono">{user.request_count} builds</span>
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="number" aria-label="Used count" className={cn(FIELD_CLASS, "w-20")} value={actions.draft} onChange={(e) => actions.setDraft(parseInt(e.target.value) || 0)} />
      <Button size="sm" className="min-h-11 sm:min-h-8" disabled={actions.saving} onClick={() => actions.saveCount(user.id, actions.draft)}>Save</Button>
      <Button size="sm" variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => actions.setEditingId(null)}>Cancel</Button>
    </div>
  )
}

function UserButtons({ user, actions }: { user: UserItem; actions: UserActions }) {
  const size = "min-h-11 sm:min-h-8"
  return (
    <>
      <Button size="sm" className={size} variant={user.is_pro ? "outline" : "default"} disabled={user.is_admin} title={user.is_admin ? "Admins are automatically Pro" : undefined} onClick={() => actions.toggleTier(user)}>
        {user.is_pro ? "Demote" : "Make Pro"}
      </Button>
      <Button size="sm" className={size} variant="outline" onClick={() => { actions.setEditingId(user.id); actions.setDraft(user.request_count) }}>Set used</Button>
      <Button size="sm" className={size} variant="ghost" onClick={() => actions.saveCount(user.id, 0)}>Reset</Button>
      <Button size="sm" className={size} variant="outline" onClick={() => actions.editCaps(user)}>Caps</Button>
    </>
  )
}

export function UsersTab() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState(5)

  const { data: users = [], isLoading } = useQuery<UserItem[]>({
    queryKey: ["admin", "users", search],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "50" })
      if (search.trim()) params.set("search", search.trim())
      return fetchJson<UserItem[]>(`/api/backend/admin/users?${params}`)
    },
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] })

  const rateLimit = useMutation({
    mutationFn: ({ userId, request_count }: { userId: string; request_count: number }) =>
      sendJson(`/api/backend/admin/users/${userId}/rate-limit`, "PUT", { request_count }, "Failed to update rate limit"),
    onSuccess: () => { refresh(); setEditingId(null) },
  })
  const credits = useMutation({
    mutationFn: (payload: { userId: string; daily_cap: number; monthly_cap: number; admin_note?: string }) =>
      sendJson(`/api/backend/admin/users/${payload.userId}/credits`, "PUT", payload, "Failed to update credits"),
    onSuccess: refresh,
  })
  const tier = useMutation({
    mutationFn: ({ userId, is_pro }: { userId: string; is_pro: boolean }) =>
      sendJson(`/api/backend/admin/users/${userId}/tier`, "PATCH", { is_pro }, "Failed to update user tier"),
    onSuccess: refresh,
  })

  const actions: UserActions = {
    editingId,
    draft,
    setDraft,
    setEditingId,
    saveCount: (userId, count) => rateLimit.mutate({ userId, request_count: count }),
    saving: rateLimit.isPending,
    toggleTier: (user) => tier.mutate({ userId: user.id, is_pro: !user.is_pro }),
    editCaps: (user) => {
      const daily = Number(prompt("Daily cap", String(user.daily_cap ?? 5)))
      const monthly = Number(prompt("Monthly cap", String(user.monthly_cap ?? 150)))
      if (!Number.isNaN(daily) && !Number.isNaN(monthly)) credits.mutate({ userId: user.id, daily_cap: daily, monthly_cap: monthly, admin_note: user.admin_note })
    },
  }

  return (
    <div className="space-y-4 pixel-enter">
      <div className="border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users by email or name" aria-label="Search users" className={FIELD_CLASS} />
      </div>
      <PendingDeletionsPanel />
      {(tier.isError || rateLimit.isError || credits.isError) && <Note tone="error">That change could not be saved. Try again.</Note>}

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : users.length === 0 ? (
        <Note>No users match this search.</Note>
      ) : (
        <>
          <ul className="space-y-3 lg:hidden">
            {users.map((u) => (
              <li key={u.id} className="panel-strong relative p-3">
                {u.deletion_scheduled_for && <DeletionOverlay />}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-black dark:text-white">
                      <span className="break-words">{u.name || "No name"}</span>
                      {u.is_admin && <Pill tone="bad">Admin</Pill>}
                      {u.deletion_scheduled_for && <DeletionPill scheduledFor={u.deletion_scheduled_for} />}
                    </p>
                    <p className="[overflow-wrap:anywhere] text-[11px] text-zinc-500">{u.email}</p>
                  </div>
                  <TierPill user={u} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                  <div><dt className="text-zinc-500">Joined</dt><dd className="font-mono">{new Date(u.created_at).toLocaleDateString()}</dd></div>
                  <div><dt className="text-zinc-500">Caps</dt><dd className="font-mono">Daily {u.daily_cap ?? 5} · Mo {u.monthly_count ?? 0}/{u.monthly_cap ?? 150}</dd></div>
                  <div className="col-span-2">
                    <dt className="text-zinc-500">Used (24h)</dt>
                    <dd><UsageEditor user={u} actions={actions} />{u.reset_at && <span className="mt-0.5 block text-[10px] text-zinc-400">Resets {new Date(u.reset_at).toLocaleString()}</span>}</dd>
                  </div>
                </dl>
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-700">
                  <UserButtons user={u} actions={actions} />
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 lg:block">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-100 font-bold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  <th className="p-3">Name & email</th>
                  <th className="p-3">Tier</th>
                  <th className="p-3">Joined</th>
                  <th className="p-3">Used (24h)</th>
                  <th className="p-3">Caps</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                {users.map((u) => (
                  <tr
                    key={u.id}
                    className={cn(
                      "relative",
                      u.deletion_scheduled_for ? "bg-red-50/70 dark:bg-red-950/25" : "hover:bg-zinc-50 dark:hover:bg-zinc-800",
                    )}
                  >
                    <td className="p-3">
                      {u.deletion_scheduled_for && <DeletionOverlay />}
                      <p className="flex flex-wrap items-center gap-1.5 font-bold text-black dark:text-white">
                        {u.name || "No name"}
                        {u.is_admin && <Pill tone="bad">Admin</Pill>}
                        {u.deletion_scheduled_for && <DeletionPill scheduledFor={u.deletion_scheduled_for} />}
                      </p>
                      <p className="text-[10px] text-zinc-500">{u.email}</p>
                    </td>
                    <td className="p-3"><TierPill user={u} /></td>
                    <td className="p-3 text-zinc-500">{new Date(u.created_at).toLocaleDateString()}</td>
                    <td className="p-3"><UsageEditor user={u} actions={actions} />{u.reset_at && <p className="mt-1 text-[10px] font-semibold text-zinc-400">Resets {new Date(u.reset_at).toLocaleString()}</p>}</td>
                    <td className="p-3 font-mono text-zinc-600 dark:text-zinc-300"><p>Daily {u.daily_cap ?? 5}</p><p>Monthly {u.monthly_count ?? 0}/{u.monthly_cap ?? 150}</p></td>
                    <td className="p-3"><div className="flex flex-wrap justify-end gap-1.5"><UserButtons user={u} actions={actions} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
