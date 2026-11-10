"use client"

import { useState } from "react"
import { Trash2 } from "lucide-react"
import { signOutAfterDeletionAction } from "@/app/actions"
import { DELETION_GRACE_DAYS } from "@/lib/account-deletion"
import { clearResumePdfCache } from "@/lib/resume-pdf-cache"

function signInLabel(provider: string | null) {
  if (provider === "google") return "with Google"
  if (provider === "github") return "with GitHub"
  return "with your email and password"
}

export function DeleteAccountSection({ email, provider }: { email: string | null; provider: string | null }) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const matches = !!email && typed.trim().toLowerCase() === email.trim().toLowerCase()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!matches || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/backend/account/deletion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm_email: typed.trim() }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { detail?: unknown }
        setError(typeof data.detail === "string" ? data.detail : "Couldn't delete your account. Try again.")
        setBusy(false)
        return
      }
      await clearResumePdfCache().catch(() => {})
      await signOutAfterDeletionAction()
    } catch {
      setError("Couldn't reach Résumer. Check your connection and try again.")
      setBusy(false)
    }
  }

  return (
    <section className="soft-card mt-5 p-6 md:p-7" aria-labelledby="delete-account-heading">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h2 id="delete-account-heading" className="text-sm font-semibold text-ink-muted">Delete account</h2>
          <p className="mt-2 max-w-xl text-sm text-ink-soft">
            Your account is locked right away and permanently deleted after {DELETION_GRACE_DAYS} days.
            Sign in again before then and everything comes back.
          </p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 self-start rounded-md border border-line-strong bg-paper/70 px-4 text-sm font-semibold text-ink transition-colors hover:border-red-500/50 hover:text-red-600"
          >
            <Trash2 size={15} aria-hidden="true" />
            Delete account
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={submit} className="mt-5 border-t border-line pt-5">
          <ul className="max-w-xl list-disc space-y-1.5 pl-5 text-sm text-ink-soft">
            <li>You&apos;ll be signed out on every device, and AI connectors (ChatGPT, Claude and others) are disconnected.</li>
            <li>
              After {DELETION_GRACE_DAYS} days we delete your profile, generated résumés, PDFs and support requests. That
              can&apos;t be undone.
            </li>
            <li>To cancel, sign in {signInLabel(provider)} within {DELETION_GRACE_DAYS} days. We&apos;ll email you too.</li>
          </ul>

          <label htmlFor="delete-confirm" className="mt-5 block text-sm font-semibold text-ink">
            Type <span className="select-all break-all font-mono text-[13px]">{email ?? "your email"}</span> to confirm
          </label>
          <input
            id="delete-confirm"
            type="email"
            autoComplete="off"
            spellCheck={false}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={busy}
            className="mt-2 h-10 w-full max-w-md rounded-md border border-line-strong bg-paper/70 px-3 text-sm text-ink outline-none transition-colors focus:border-ink/40"
          />

          {error && (
            <p role="alert" className="mt-3 text-sm font-semibold text-red-600">
              {error}
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={!matches || busy}
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 size={15} aria-hidden="true" />
              {busy ? "Deleting…" : "Delete my account"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setTyped("")
                setError(null)
              }}
              disabled={busy}
              className="inline-flex h-10 cursor-pointer items-center rounded-md border border-line px-4 text-sm font-semibold text-ink-soft transition-colors hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
