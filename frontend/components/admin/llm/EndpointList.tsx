"use client"

import { Plus, PlugZap } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { LlmEndpoint, LlmRole } from "./types"
import { EndpointCard } from "./EndpointCard"

const COMPATIBLE = ["OpenAI", "Azure OpenAI (v1)", "Together", "Groq", "Fireworks", "DeepInfra", "vLLM", "Ollama", "LM Studio", "LiteLLM"]

export function EndpointEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="panel-strong grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.1fr_1fr] lg:items-center">
      <div>
        <span
          aria-hidden
          className="inline-flex h-10 w-10 items-center justify-center border-2 border-zinc-900 bg-[#ff4e26] text-white shadow-[2px_2px_0_#18181b] dark:border-zinc-500 dark:shadow-[2px_2px_0_#000]"
        >
          <PlugZap size={18} />
        </span>
        <h4 className="mt-4 text-lg font-black uppercase tracking-tight">Add your first endpoint</h4>
        <p className="mt-1.5 max-w-md text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          Any server that speaks the OpenAI Chat Completions API works. Paste its base URL and token. Models are detected
          automatically.
        </p>
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Compatible servers">
          {COMPATIBLE.map((n) => (
            <li key={n} className="border border-zinc-300 px-1.5 py-px font-mono text-[10px] text-zinc-500 dark:border-zinc-700">
              {n}
            </li>
          ))}
          <li className="px-1 py-px font-mono text-[10px] text-zinc-400">…</li>
        </ul>
        <Button className="mt-5" onClick={onAdd}>
          <Plus size={15} /> Add endpoint
        </Button>
      </div>
      <ol className="grid gap-px border-2 border-zinc-900 bg-zinc-900 dark:border-zinc-700 dark:bg-zinc-700">
        {[
          ["Connect", "Base URL + bearer token. We find /v1/models for you."],
          ["Pick a model", "Search the live catalog, or type any id."],
          ["Route tasks", "Make it primary for resume generation, add fallbacks later."],
        ].map(([title, body], i) => (
          <li key={title} className="flex gap-3 bg-white px-4 py-3 dark:bg-zinc-900">
            <span className="font-mono text-xs font-black text-[#ff4e26]">{String(i + 1).padStart(2, "0")}</span>
            <div>
              <p className="text-xs font-black uppercase tracking-wide">{title}</p>
              <p className="mt-0.5 text-xs text-zinc-500">{body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function EndpointList({
  endpoints,
  roles,
  onAdd,
  onEdit,
  onDelete,
}: {
  endpoints: LlmEndpoint[]
  roles: LlmRole[]
  onAdd: () => void
  onEdit: (endpoint: LlmEndpoint) => void
  onDelete: (endpoint: LlmEndpoint) => void
}) {
  if (endpoints.length === 0) return <EndpointEmptyState onAdd={onAdd} />
  return (
    <div className="space-y-4">
      {endpoints.map((ep) => (
        <EndpointCard key={ep.id} endpoint={ep} roles={roles} onEdit={() => onEdit(ep)} onDelete={() => onDelete(ep)} />
      ))}
    </div>
  )
}
