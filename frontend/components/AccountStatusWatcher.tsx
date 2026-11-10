"use client"

import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { signOut, useSession } from "next-auth/react"
import { CheckCircle2, X } from "lucide-react"
import { ACCOUNT_PENDING_DELETION } from "@/lib/account-deletion"

type DeletionStatus = { restored_at: string | null } | { pendingDeletion: true }

const STATUS_KEY = ["account", "deletion-status"]

async function fetchDeletionStatus(): Promise<DeletionStatus | null> {
  const res = await fetch("/api/backend/account/deletion", { cache: "no-store" })
  if (res.status === 401) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    // The proxy already cleared the session cookie; finish signing out client-side.
    return data.error === ACCOUNT_PENDING_DELETION ? { pendingDeletion: true } : null
  }
  if (!res.ok) return null
  return (await res.json()) as DeletionStatus
}

/**
 * Checks the account once per page load while signed in:
 * - a session whose account was scheduled for deletion (e.g. from another device) is
 *   signed out, since only a fresh sign-in can restore the account;
 * - right after a sign-in cancelled a pending deletion, says so until dismissed.
 */
export function AccountStatusWatcher() {
  const { status } = useSession()
  const queryClient = useQueryClient()
  const [dismissed, setDismissed] = useState(false)
  const { data } = useQuery({
    queryKey: STATUS_KEY,
    queryFn: fetchDeletionStatus,
    enabled: status === "authenticated",
    staleTime: Infinity,
    retry: false,
  })

  const pending = !!data && "pendingDeletion" in data
  useEffect(() => {
    if (pending) void signOut({ redirectTo: `/?auth_error=${ACCOUNT_PENDING_DELETION}` })
  }, [pending])

  const restoredAt = data && "restored_at" in data ? data.restored_at : null
  if (!restoredAt || dismissed || status !== "authenticated") return null

  const dismiss = () => {
    setDismissed(true)
    queryClient.setQueryData(STATUS_KEY, { restored_at: null })
    void fetch("/api/backend/account/deletion/restored-notice", { method: "DELETE" }).catch(() => {})
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-[60] px-4 md:top-[4.75rem] md:px-5">
      <div
        role="status"
        className="pointer-events-auto mx-auto flex w-full max-w-xl items-start gap-2.5 rounded-md border border-emerald-300/70 bg-emerald-50/90 p-3.5 text-sm text-emerald-950 shadow-[0_18px_50px_-24px_rgba(74,32,4,0.55)] backdrop-blur-xl dark:border-emerald-500/40 dark:bg-emerald-950/85 dark:text-emerald-50"
      >
        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        <p className="flex-1 text-sm font-semibold">
          Welcome back. Signing in cancelled your account deletion, and everything is where you left it. Reconnect any AI
          connectors you use.
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-emerald-100 dark:hover:bg-emerald-900"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
