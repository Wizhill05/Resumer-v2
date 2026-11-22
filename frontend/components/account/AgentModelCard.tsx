"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Bot, Sparkles } from "lucide-react"
import {
  OWN_MODEL_POINTS,
  parseInferenceMode,
  type InferenceMode,
  type InferenceModeState,
} from "@/lib/inference-mode"

const QUERY_KEY = ["inference-mode"]

async function fetchMode(): Promise<InferenceModeState> {
  const res = await fetch("/api/backend/inference-mode", { cache: "no-store" })
  if (!res.ok) throw new Error(`inference-mode ${res.status}`)
  const data = (await res.json()) as { mode?: unknown; changed_at?: string | null }
  return { mode: parseInferenceMode(data.mode), changed_at: data.changed_at ?? null }
}

async function saveMode(mode: InferenceMode): Promise<InferenceModeState> {
  const res = await fetch("/api/backend/inference-mode", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  })
  if (!res.ok) throw new Error(`inference-mode ${res.status}`)
  const data = (await res.json()) as { mode?: unknown; changed_at?: string | null }
  return { mode: parseInferenceMode(data.mode), changed_at: data.changed_at ?? null }
}

/**
 * Which model writes résumés that an AI agent builds through the Résumer connector.
 * Off (Résumer's AI) by default. Turning it on is a deliberate two-click action.
 */
export function AgentModelCard() {
  const queryClient = useQueryClient()
  const { data, isPending, isError } = useQuery({ queryKey: QUERY_KEY, queryFn: fetchMode })
  const [confirming, setConfirming] = useState(false)
  const mutation = useMutation({
    mutationFn: saveMode,
    onSuccess: (next) => {
      queryClient.setQueryData(QUERY_KEY, next)
      setConfirming(false)
    },
  })

  const ownModel = data?.mode === "own_model"

  return (
    <section className="soft-card mt-5 p-6 md:p-7" aria-labelledby="agent-model-heading">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h2 id="agent-model-heading" className="text-sm font-semibold text-ink-muted">
            Agent résumés
          </h2>
          <p className="mt-2 flex items-center gap-2 text-[15px] font-semibold text-ink">
            {ownModel ? (
              <Sparkles size={15} aria-hidden="true" className="text-ember" />
            ) : (
              <Bot size={15} aria-hidden="true" className="text-ink-soft" />
            )}
            {isPending ? "Loading…" : isError ? "Couldn't load this setting" : ownModel ? "Written by your agent's model" : "Written by Résumer's AI"}
          </p>
          <p className="mt-1.5 max-w-xl text-sm text-ink-soft">
            {ownModel
              ? "When an AI agent builds a résumé through Résumer, its own model writes the text and Résumer fits and checks the page. These builds don't count toward your daily limit."
              : "When an AI agent builds a résumé through Résumer, Résumer's AI writes it and it counts toward your daily limit. You can let your agent's own model write it instead."}
          </p>
        </div>

        {!isPending && !isError && !confirming && (
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => (ownModel ? mutation.mutate("resumer") : setConfirming(true))}
            className="inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 self-start rounded-md border border-line-strong bg-paper/70 px-4 text-sm font-semibold text-ink transition-colors hover:border-ink/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {ownModel ? (mutation.isPending ? "Switching…" : "Switch back to Résumer's AI") : "Use my agent's model…"}
          </button>
        )}
      </div>

      {confirming && (
        <div className="mt-5 border-t border-line pt-5">
          <ol className="max-w-xl divide-y divide-line border-y border-line">
            {OWN_MODEL_POINTS.map((point, i) => (
              <li key={point} className="flex gap-4 py-2.5 text-sm text-ink-soft">
                <span className="w-5 shrink-0 pt-px font-mono text-xs font-light text-ink-faint">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ol>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate("own_model")}
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-paper transition-colors hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Sparkles size={15} aria-hidden="true" />
              {mutation.isPending ? "Turning on…" : "Turn on"}
            </button>
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => setConfirming(false)}
              className="inline-flex h-10 cursor-pointer items-center rounded-md border border-line px-4 text-sm font-semibold text-ink-soft transition-colors hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mutation.isError && (
        <p role="alert" className="mt-3 text-sm font-semibold text-red-600">
          Couldn&apos;t save this setting. Try again.
        </p>
      )}
    </section>
  )
}
