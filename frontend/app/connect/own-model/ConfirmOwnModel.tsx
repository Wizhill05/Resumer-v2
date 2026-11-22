"use client"

import { useActionState, useEffect, useState } from "react"
import Link from "next/link"
import { Check, Loader2, Sparkles } from "lucide-react"
import { LoginModal } from "@/components/LoginModal"
import { OWN_MODEL_POINTS, isWellFormedChallenge } from "@/lib/inference-mode"
import { confirmOwnModel, inspectOwnModel, type ChallengeProblem, type ConfirmState, type InspectResult } from "./actions"

const PAGE_PATH = "/connect/own-model"
// Per-tab, so a sign-in redirect in this tab can come back to the same confirmation.
const STORAGE_KEY = "resumer:own-model-challenge"

const PROBLEMS: Record<ChallengeProblem, { title: string; body: string }> = {
  used: {
    title: "This link was already used",
    body: "Each confirmation link works once. If you still want to switch, ask your agent for a new link.",
  },
  expired: {
    title: "This link has expired",
    body: "Confirmation links last 15 minutes. Ask your agent for a new one.",
  },
  invalid: {
    title: "This link isn't valid",
    body: "Check that the whole link was copied, or ask your agent for a new one.",
  },
  wrong_account: {
    title: "This link is for a different account",
    body: "Sign out, then sign in with the Résumer account your agent is connected to and open the link again.",
  },
  signed_out: {
    title: "Your session ended",
    body: "Reload the page and sign in again.",
  },
  network: {
    title: "Résumer couldn't check this link",
    body: "Something went wrong on our side. Wait a moment and try again.",
  },
}

/** Reads the challenge from `#c=` (or a legacy `?c=`), keeps it for this tab, and strips it from the URL. */
function takeChallenge(): string | null {
  const hash = new URLSearchParams(window.location.hash.slice(1))
  const query = new URLSearchParams(window.location.search)
  const fresh = hash.get("c") ?? query.get("c")
  const inQuery = query.has("c")
  // Drop only the challenge; keep anything else (e.g. auth_error from a failed sign-in).
  query.delete("c")
  const rest = query.toString()
  if (hash.has("c") || inQuery) {
    window.history.replaceState(null, "", rest ? `${PAGE_PATH}?${rest}` : PAGE_PATH)
  }
  if (fresh !== null) {
    if (!isWellFormedChallenge(fresh)) {
      // A new but broken link must not fall back to an older link saved in this tab.
      sessionStorage.removeItem(STORAGE_KEY)
      return null
    }
    sessionStorage.setItem(STORAGE_KEY, fresh)
  }
  const stored = sessionStorage.getItem(STORAGE_KEY)
  return stored && isWellFormedChallenge(stored) ? stored : null
}

function Card({ children, labelledBy }: { children: React.ReactNode; labelledBy: string }) {
  return (
    <section className="soft-card p-6 md:p-7" aria-labelledby={labelledBy}>
      {children}
    </section>
  )
}

function ProblemCard({ problem }: { problem: ChallengeProblem }) {
  return (
    <Card labelledBy="own-model-problem">
      <h2 id="own-model-problem" className="text-lg font-semibold text-ink">
        {PROBLEMS[problem].title}
      </h2>
      <p className="mt-2 text-sm text-ink-soft">{PROBLEMS[problem].body}</p>
      <p className="mt-4 text-sm text-ink-soft">
        You can also change this any time from your{" "}
        <Link href="/account" className="font-semibold text-ink underline underline-offset-4 hover:text-ember">
          account page
        </Link>
        .
      </p>
    </Card>
  )
}

function DoneCard({ already }: { already: boolean }) {
  return (
    <section className="soft-card p-6 md:p-7" aria-labelledby="own-model-done" role="status">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ember-tint text-ember">
        <Check size={18} aria-hidden="true" />
      </span>
      <h2 id="own-model-done" className="mt-4 text-lg font-semibold text-ink">
        {already ? "It's already on" : "Done. Your agent's model is on"}
      </h2>
      <p className="mt-2 text-sm text-ink-soft">
        Go back to your agent and tell it you confirmed. Résumés it builds from now on are written by its own model
        and don&apos;t count toward your daily limit.
      </p>
      <p className="mt-4 text-sm text-ink-soft">
        To switch back, ask your agent, or use the{" "}
        <Link href="/account" className="font-semibold text-ink underline underline-offset-4 hover:text-ember">
          account page
        </Link>
        .
      </p>
    </section>
  )
}

export function ConfirmOwnModel({ signedIn, email }: { signedIn: boolean; email: string | null }) {
  // undefined: not read yet (the first render matches the server), null: no usable token.
  const [token, setToken] = useState<string | null | undefined>(undefined)
  const [inspected, setInspected] = useState<InspectResult | null>(null)
  const [state, formAction, pending] = useActionState<ConfirmState, FormData>(confirmOwnModel, { status: "idle" })

  useEffect(() => {
    // The fragment and sessionStorage only exist in the browser, after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(takeChallenge())
  }, [])

  useEffect(() => {
    if (!token || !signedIn) return
    let cancelled = false
    void inspectOwnModel(token).then((result) => {
      if (!cancelled) setInspected(result)
    })
    return () => {
      cancelled = true
    }
  }, [token, signedIn])

  useEffect(() => {
    if (state.status === "confirmed") sessionStorage.removeItem(STORAGE_KEY)
  }, [state.status])

  if (token === undefined || (token && signedIn && !inspected)) {
    return (
      <Card labelledBy="own-model-loading">
        <p id="own-model-loading" className="flex items-center gap-2 text-sm text-ink-soft">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Checking the link…
        </p>
      </Card>
    )
  }
  if (!token) return <ProblemCard problem="invalid" />

  if (!signedIn) {
    return (
      <Card labelledBy="own-model-signin">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">Your agent asked to switch</p>
        <h2 id="own-model-signin" className="mt-2 text-lg font-semibold text-ink">
          Sign in to confirm
        </h2>
        <p className="mt-2 text-sm text-ink-soft">
          Sign in with the Résumer account your agent is connected to. You&apos;ll come straight back here to confirm.
        </p>
        <div className="mt-5">
          <LoginModal callbackUrl={PAGE_PATH} returnTo={PAGE_PATH} />
        </div>
      </Card>
    )
  }

  if (state.status === "confirmed") return <DoneCard already={false} />
  if (inspected?.status === "error") return <ProblemCard problem={inspected.reason} />
  if (inspected?.status === "valid" && inspected.currentMode === "own_model") return <DoneCard already />

  return (
    <Card labelledBy="own-model-confirm">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">Your agent asked to switch</p>
      <h2 id="own-model-confirm" className="mt-2 text-lg font-semibold text-ink">
        Write résumés with your agent&apos;s model?
      </h2>
      {email && (
        <p className="mt-1 text-sm text-ink-soft">
          Signed in as <span className="font-semibold text-ink">{email}</span>
        </p>
      )}

      <ol className="mt-5 divide-y divide-line border-y border-line">
        {OWN_MODEL_POINTS.map((point, i) => (
          <li key={point} className="flex gap-4 py-3 text-sm text-ink-soft">
            <span className="w-5 shrink-0 pt-px font-mono text-xs font-light text-ink-faint">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span>{point}</span>
          </li>
        ))}
      </ol>

      <p className="mt-4 text-sm text-ink-soft">Only continue if you asked your agent for this.</p>

      {state.status === "error" && (
        <p role="alert" className="mt-3 text-sm font-semibold text-red-600">
          {PROBLEMS[state.reason].title}. {PROBLEMS[state.reason].body}
        </p>
      )}

      <form action={formAction} className="mt-5 flex flex-wrap gap-3">
        <input type="hidden" name="challenge" value={token} />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-paper transition-colors hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Sparkles size={15} aria-hidden="true" />
          {pending ? "Turning on…" : "Use my agent's model"}
        </button>
        <Link
          href="/"
          className="inline-flex h-10 items-center rounded-md border border-line px-4 text-sm font-semibold text-ink-soft transition-colors hover:text-ink"
        >
          Not now
        </Link>
      </form>
    </Card>
  )
}
