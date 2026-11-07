"use client"

import { useId, useState } from "react"
import { CheckCircle2, Play, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { LlmEndpoint, LlmTestResponse } from "./types"
import { useTestEndpoint } from "./hooks"
import { describeError } from "./errors"
import { chatModelIds, formatLatency } from "./format"
import { errorMessage } from "./api"
import { FieldLabel, Spinner, selectCls } from "./primitives"

export function TestResult({ result }: { result: LlmTestResponse }) {
  if (!result.ok) {
    const e = describeError(result.error)
    return (
      <div className="border-l-4 border-red-600 bg-red-50 px-3 py-2.5 dark:bg-red-950/40" role="status">
        <p className="flex items-center gap-1.5 text-xs font-black text-red-800 dark:text-red-200">
          <XCircle size={14} aria-hidden /> {e.title}
          {result.error?.status_code ? <span className="font-mono font-medium">HTTP {result.error.status_code}</span> : null}
          {result.latency_ms !== null && <span className="ml-auto font-mono font-medium">{formatLatency(result.latency_ms)}</span>}
        </p>
        {e.message && <p className="mt-1 text-xs text-red-900 dark:text-red-200">{e.message}</p>}
        {e.hint && <p className="mt-1 text-[11px] text-red-700/80 dark:text-red-300/80">{e.hint}</p>}
      </div>
    )
  }
  return (
    <div className="border border-emerald-300 dark:border-emerald-900" role="status">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-emerald-200 bg-emerald-50 px-3 py-1.5 font-mono text-[11px] text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
        <span className="flex items-center gap-1.5 font-sans font-black">
          <CheckCircle2 size={14} aria-hidden /> Responded
        </span>
        <span>{formatLatency(result.latency_ms)}</span>
        {result.model && <span className="truncate">{result.model}</span>}
        {result.usage && (
          <span className="ml-auto">
            {result.usage.prompt_tokens ?? "?"} in · {result.usage.completion_tokens ?? "?"} out
          </span>
        )}
      </div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words bg-white px-3 py-2 font-mono text-xs text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
        {result.output || <span className="italic text-zinc-400">(empty response)</span>}
      </pre>
    </div>
  )
}

export function TestResultPanel({ endpoint, onClose }: { endpoint: LlmEndpoint; onClose: () => void }) {
  const uid = useId()
  const ids = chatModelIds(endpoint)
  const [model, setModel] = useState(endpoint.default_model ?? ids[0] ?? "")
  const [prompt, setPrompt] = useState("")
  const test = useTestEndpoint()

  return (
    <div className="space-y-3 border-t-2 border-dashed border-zinc-300 bg-zinc-50/80 p-4 dark:border-zinc-700 dark:bg-zinc-950/30">
      <form
        className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          test.mutate({ id: endpoint.id, body: { model: model.trim() || undefined, prompt: prompt.trim() || undefined } })
        }}
      >
        <div className="min-w-0">
          <FieldLabel htmlFor={`${uid}-model`}>Model</FieldLabel>
          {ids.length > 0 ? (
            <select id={`${uid}-model`} value={model} onChange={(e) => setModel(e.target.value)} className={cn(selectCls, "font-mono text-xs")}>
              {ids.map((id) => (
                <option key={id} value={id}>
                  {id}
                  {id === endpoint.default_model ? "  (default)" : ""}
                </option>
              ))}
            </select>
          ) : (
            <Input id={`${uid}-model`} value={model} onChange={(e) => setModel(e.target.value)} placeholder="model id" className="font-mono text-xs" />
          )}
        </div>
        <div className="min-w-0">
          <FieldLabel htmlFor={`${uid}-prompt`} optional>
            Prompt
          </FieldLabel>
          <Input id={`${uid}-prompt`} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Reply with the single word: pong" />
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="default" disabled={test.isPending || (!model.trim() && !endpoint.default_model)}>
            {test.isPending ? <Spinner /> : <Play size={14} />} Run
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </form>
      {test.isPending && (
        <p className="flex items-center gap-2 text-xs text-zinc-500" role="status">
          <Spinner /> Waiting for a completion (up to {endpoint.timeout_seconds}s)…
        </p>
      )}
      {test.isError && <p className="text-xs font-semibold text-red-600">{errorMessage(test.error)}</p>}
      {test.data && !test.isPending && <TestResult result={test.data} />}
    </div>
  )
}
