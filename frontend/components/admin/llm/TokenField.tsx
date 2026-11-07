"use client"

import { useId, useState } from "react"
import { Eye, EyeOff, KeyRound, RotateCcw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { ApiKeyStatus } from "./types"
import { Callout, FieldLabel } from "./primitives"

/**
 * - `new`: create flow, value is the typed token (may be empty: no auth).
 * - `keep`: existing token is kept untouched (value ignored).
 * - `replace`: existing token is replaced by `value` (empty = keep).
 * - `remove`: existing token is removed on save.
 */
export type TokenState = { action: "new" | "keep" | "replace" | "remove"; value: string }

export function TokenField({
  state,
  onChange,
  hasStored,
  hint,
  status,
  inputId,
}: {
  state: TokenState
  onChange: (next: TokenState) => void
  hasStored: boolean
  hint: string | null
  status: ApiKeyStatus | null
  inputId?: string
}) {
  const fallbackId = useId()
  const id = inputId ?? fallbackId
  const [revealed, setRevealed] = useState(false)
  const editing = state.action === "new" || state.action === "replace"

  return (
    <div>
      <FieldLabel htmlFor={editing ? id : undefined} optional={!hasStored} hint={editing ? "sent as Authorization: Bearer …" : undefined}>
        Bearer token
      </FieldLabel>

      {status === "undecryptable" && state.action !== "remove" && (
        <Callout tone="danger" className="mb-2" title="Stored token can't be decrypted">
          The server secret changed since this token was saved. Paste the token again to keep using this endpoint.
        </Callout>
      )}

      {!editing && hasStored && (
        <div
          className={cn(
            "flex flex-wrap items-center gap-2 border px-3 py-1.5",
            state.action === "remove"
              ? "border-dashed border-red-400 bg-red-50/60 dark:border-red-800 dark:bg-red-950/30"
              : "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900",
          )}
        >
          <KeyRound size={14} aria-hidden className="text-zinc-400" />
          <span className={cn("font-mono text-sm tracking-wider", state.action === "remove" && "text-zinc-400 line-through")}>
            ••••••••{hint ? ` ${hint.replace(/^…/, "")}` : ""}
          </span>
          {state.action === "remove" ? (
            <>
              <span className="text-[11px] font-bold text-red-600 dark:text-red-400">Removed on save</span>
              <Button size="xs" variant="ghost" className="ml-auto" onClick={() => onChange({ action: "keep", value: "" })}>
                <RotateCcw size={12} /> Undo
              </Button>
            </>
          ) : (
            <div className="ml-auto flex gap-1.5">
              <Button size="xs" variant="outline" onClick={() => onChange({ action: "replace", value: "" })}>
                Replace
              </Button>
              <Button
                size="xs"
                variant="ghost"
                className="text-red-600 dark:text-red-400"
                onClick={() => onChange({ action: "remove", value: "" })}
              >
                <Trash2 size={12} /> Remove
              </Button>
            </div>
          )}
        </div>
      )}

      {(editing || !hasStored) && (
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Input
              id={id}
              type={revealed ? "text" : "password"}
              value={state.value}
              onChange={(e) => onChange({ action: state.action === "keep" ? "replace" : state.action, value: e.target.value })}
              placeholder={state.action === "replace" ? "Paste the new token" : "sk-… (leave empty if the server needs no auth)"}
              autoComplete="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              className="pr-10 font-mono"
            />
            {state.value && (
              <button
                type="button"
                onClick={() => setRevealed((r) => !r)}
                aria-label={revealed ? "Hide token" : "Show token"}
                aria-pressed={revealed}
                className="absolute inset-y-0 right-0 inline-flex w-9 cursor-pointer items-center justify-center text-zinc-400 hover:text-black focus-visible:outline-2 focus-visible:outline-[#ff4e26] dark:hover:text-white"
              >
                {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            )}
          </div>
          {state.action === "replace" && hasStored && (
            <Button variant="ghost" size="default" onClick={() => onChange({ action: "keep", value: "" })}>
              Cancel
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
