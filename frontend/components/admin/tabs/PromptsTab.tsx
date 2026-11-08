"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { PromptConfig, PromptTestRun } from "../api-types"
import { FIELD_CLASS, Note, Panel, Skeleton, fetchJson, sendJson } from "../shared"

const linkButton = "min-h-11 cursor-pointer px-2 font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:text-[#ff4e26] dark:text-zinc-400 sm:min-h-0 sm:px-0"

export function PromptsTab() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<PromptConfig | null>(null)
  const [systemPrompt, setSystemPrompt] = useState("")
  const [userPrompt, setUserPrompt] = useState("")
  const [variables, setVariables] = useState("{}")
  const [bulkCases, setBulkCases] = useState("[]")
  const [result, setResult] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const { data: prompts = [], isLoading } = useQuery<PromptConfig[]>({
    queryKey: ["admin", "prompts"],
    queryFn: () => fetchJson<PromptConfig[]>("/api/backend/admin/prompts"),
  })
  const { data: runs = [] } = useQuery<PromptTestRun[]>({
    queryKey: ["admin", "prompt-test-runs"],
    queryFn: () => fetchJson<PromptTestRun[]>("/api/backend/admin/prompts/test-runs"),
  })

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return needle ? prompts.filter((p) => p.name.toLowerCase().includes(needle)) : prompts
  }, [prompts, search])
  const dirty = !!selected && (systemPrompt !== selected.system_prompt || userPrompt !== (selected.user_prompt || ""))
  const bulkCount = useMemo(() => {
    try {
      const parsed = JSON.parse(bulkCases)
      return Array.isArray(parsed) ? parsed.length : 0
    } catch {
      return 0
    }
  }, [bulkCases])

  const select = (p: PromptConfig) => {
    setSelected(p)
    setSystemPrompt(p.system_prompt)
    setUserPrompt(p.user_prompt || "")
  }

  const save = useMutation({
    mutationFn: (payload: { name: string; system_prompt: string; user_prompt?: string }) =>
      sendJson(`/api/backend/admin/prompts/${payload.name}`, "PUT", payload, "Failed to save prompt config"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "prompts"] })
      alert("Prompt updated successfully!")
    },
  })

  const parseJson = (text: string, label: string) => {
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`${label} is not valid JSON.`)
    }
  }
  const playground = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Select a prompt first")
      const body = { prompt_name: selected.name, system_prompt: systemPrompt, user_prompt: userPrompt, variables: parseJson(variables, "Variables") }
      return sendJson<{ output?: string; error_message?: string }>("/api/backend/admin/prompts/playground", "POST", body, "Prompt playground failed")
    },
    onSuccess: (data) => { setError(null); setResult(data.output || data.error_message || "No output"); queryClient.invalidateQueries({ queryKey: ["admin", "prompt-test-runs"] }) },
    onError: (err) => { setResult(""); setError(err instanceof Error ? err.message : "Prompt playground failed") },
  })
  const bulk = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Select a prompt first")
      const body = { prompt_name: selected.name, system_prompt: systemPrompt, user_prompt: userPrompt, cases: parseJson(bulkCases, "Bulk cases") }
      return sendJson<{ results: unknown }>("/api/backend/admin/prompts/bulk-test", "POST", body, "Bulk test failed")
    },
    onSuccess: (data) => { setError(null); setResult(JSON.stringify(data.results, null, 2)); queryClient.invalidateQueries({ queryKey: ["admin", "prompt-test-runs"] }) },
    onError: (err) => { setResult(""); setError(err instanceof Error ? err.message : "Bulk test failed") },
  })

  const formatVariables = () => {
    try {
      setVariables(JSON.stringify(JSON.parse(variables), null, 2))
      setError(null)
    } catch {
      setError("Variables are not valid JSON, so they cannot be formatted.")
    }
  }
  const copyOutput = async () => {
    try {
      await navigator.clipboard.writeText(result)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }
  const showRun = (run: PromptTestRun) => {
    if (run.error_message) { setResult(""); setError(run.error_message); return }
    setError(null)
    setResult(run.output || "No output was recorded for this run.")
  }

  return (
    <div className="grid min-w-0 gap-4 pixel-enter lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-6">
      <Panel className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 border-b border-zinc-200 pb-2 dark:border-zinc-700">
          <h2 className="text-[10px] font-extrabold uppercase tracking-widest text-[#ff4e26]">Prompt library</h2>
          <span className="font-mono text-[10px] text-zinc-500">{filtered.length}/{prompts.length}</span>
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter prompts" aria-label="Filter prompts" className={FIELD_CLASS} />
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:mx-0 lg:max-h-[60vh] lg:flex-col lg:gap-1 lg:overflow-x-visible lg:overflow-y-auto lg:px-0">
          {isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : filtered.length === 0 ? (
            <p className="text-xs italic text-zinc-500">{prompts.length === 0 ? "No prompts registered. Run a generation to seed them." : "No prompts match your filter."}</p>
          ) : (
            filtered.map((p) => (
              <button
                key={p.name}
                type="button"
                title={p.name}
                onClick={() => select(p)}
                className={cn(
                  "min-h-11 shrink-0 cursor-pointer border px-3 py-2 text-left transition-colors lg:w-full lg:shrink",
                  selected?.name === p.name ? "border-[#ff4e26] bg-orange-50 text-[#ff4e26] dark:bg-orange-950/40" : "border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                )}
              >
                <span className="block whitespace-nowrap font-mono text-[11px] font-semibold lg:truncate">{p.name}</span>
              </button>
            ))
          )}
        </div>
      </Panel>

      <div className="grid min-w-0 gap-4 lg:gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        {selected ? (
          <>
            <Panel className="flex flex-col space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-zinc-200 pb-3 dark:border-zinc-700">
                <div className="min-w-0">
                  <h2 className="text-sm font-extrabold uppercase tracking-wide">Edit prompt</h2>
                  <p className="mt-0.5 break-all font-mono text-[11px] text-[#ff4e26]">{selected.name}</p>
                </div>
                <span className="font-mono text-[10px] text-zinc-500">{selected.updated_at ? `Updated ${new Date(selected.updated_at).toLocaleString()}` : "Never updated"}</span>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <Label htmlFor="system-prompt" className="text-xs font-bold">System prompt</Label>
                  <span className="font-mono text-[10px] text-zinc-400">{systemPrompt.length} chars</span>
                </div>
                <Textarea id="system-prompt" rows={14} className="min-w-0 font-mono text-xs leading-relaxed" value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <Label htmlFor="user-prompt" className="text-xs font-bold">User prompt template</Label>
                  <span className="font-mono text-[10px] text-zinc-400">{userPrompt.length} chars</span>
                </div>
                <Textarea id="user-prompt" rows={8} className="min-w-0 font-mono text-xs leading-relaxed" value={userPrompt} onChange={(e) => setUserPrompt(e.target.value)} placeholder="Optional. Use {curly_braces} for variables filled in by the playground." />
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-700">
                <Button className="min-h-11 sm:min-h-8" size="sm" disabled={save.isPending || !dirty} onClick={() => save.mutate({ name: selected.name, system_prompt: systemPrompt, user_prompt: userPrompt || undefined })}>
                  {save.isPending ? "Saving..." : "Save changes"}
                </Button>
                <Button className="min-h-11 sm:min-h-8" size="sm" variant="outline" disabled={!dirty || save.isPending} onClick={() => { setSystemPrompt(selected.system_prompt); setUserPrompt(selected.user_prompt || "") }}>Discard</Button>
                {dirty && <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">Unsaved changes</span>}
              </div>
            </Panel>

            <Panel className="flex flex-col space-y-4">
              <div className="flex items-center justify-between gap-2 border-b border-zinc-200 pb-2 dark:border-zinc-700">
                <h2 className="text-[10px] font-extrabold uppercase tracking-widest text-[#ff4e26]">Playground</h2>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <Label htmlFor="playground-variables" className="text-xs font-bold">Variables</Label>
                  <button type="button" onClick={formatVariables} className={linkButton}>Format</button>
                </div>
                <Textarea id="playground-variables" rows={6} className="min-w-0 font-mono text-xs" value={variables} onChange={(e) => setVariables(e.target.value)} placeholder='{"job_desc":"..."}' />
                <p className="text-[10px] text-zinc-500">JSON object merged into the user prompt template.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" className="min-h-11 sm:min-h-8" onClick={() => playground.mutate()} disabled={playground.isPending}>{playground.isPending ? "Running..." : "Run once"}</Button>
                <Button size="sm" variant="outline" className="min-h-11 sm:min-h-8" onClick={() => bulk.mutate()} disabled={bulk.isPending}>{bulk.isPending ? "Running..." : "Run bulk cases"}</Button>
              </div>
              <div className="space-y-1.5 border-t border-zinc-200 pt-3 dark:border-zinc-700">
                <div className="flex items-baseline justify-between gap-2">
                  <Label htmlFor="playground-bulk" className="text-xs font-bold">Bulk cases</Label>
                  <span className="font-mono text-[10px] text-zinc-400">{bulkCount} cases</span>
                </div>
                <Textarea id="playground-bulk" rows={4} className="min-w-0 font-mono text-xs" value={bulkCases} onChange={(e) => setBulkCases(e.target.value)} placeholder='[{"job_desc":"case 1"}]' />
              </div>
              {error && <Note tone="error">{error}</Note>}
              <div className="space-y-1.5 border-t border-zinc-200 pt-3 dark:border-zinc-700">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[10px] font-extrabold uppercase tracking-widest text-zinc-500">Output</h3>
                  {result && <button type="button" onClick={copyOutput} className={linkButton}>{copied ? "Copied" : "Copy"}</button>}
                </div>
                {result ? (
                  <pre className="max-h-80 min-w-0 overflow-auto whitespace-pre-wrap break-words border border-zinc-200 bg-zinc-950 p-3 font-mono text-xs text-zinc-100 dark:border-zinc-700">{result}</pre>
                ) : (
                  <Note>Run the prompt to see its output here.</Note>
                )}
              </div>
              <div className="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-700">
                <h3 className="text-[10px] font-extrabold uppercase tracking-widest text-zinc-500">Recent runs</h3>
                {runs.length === 0 ? (
                  <p className="text-xs italic text-zinc-500">No test runs recorded yet.</p>
                ) : (
                  <div className="max-h-64 space-y-1.5 overflow-y-auto">
                    {runs.slice(0, 12).map((run) => (
                      <button key={run.id} type="button" onClick={() => showRun(run)} className="min-h-11 w-full cursor-pointer border border-zinc-200 p-2 text-left hover:border-[#ff4e26] dark:border-zinc-700">
                        <div className="flex items-baseline justify-between gap-2 font-mono text-[10px]">
                          <span className="break-all font-bold text-zinc-700 dark:text-zinc-300">{run.prompt_name}</span>
                          <span className={cn("shrink-0", run.status === "failed" ? "font-bold text-red-600" : "text-zinc-500")}>{run.status} · {Math.round(run.latency_ms || 0)}ms</span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[11px] text-zinc-500">{run.output || run.error_message || "No output"}</p>
                        <p className="mt-1 font-mono text-[9px] text-zinc-400">{new Date(run.created_at).toLocaleString()}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Panel>
          </>
        ) : (
          <Panel className="flex items-center justify-center p-10 text-center xl:col-span-2">
            <p className="text-sm font-semibold italic text-zinc-400">Select a prompt from the library to view and edit its template.</p>
          </Panel>
        )}
      </div>
    </div>
  )
}
