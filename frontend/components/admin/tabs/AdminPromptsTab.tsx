"use client"

import React, { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Settings,
  Play,
  Save,
  Sparkles,
} from "lucide-react"
import { PromptConfig, PromptTestRun } from "../types"

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText)
    throw new Error(errText || `Request failed with status ${res.status}`)
  }
  return res.json()
}

export function AdminPromptsTab() {
  const queryClient = useQueryClient()
  const [selectedPromptName, setSelectedPromptName] = useState<string>("planner")
  const [systemPromptOverride, setSystemPromptOverride] = useState<string | null>(null)
  const [userPromptOverride, setUserPromptOverride] = useState<string | null>(null)
  const [variablesInput, setVariablesInput] = useState<string>('{\n  "job_title": "Senior Frontend Engineer",\n  "company": "Resumer AI"\n}')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [testOutput, setTestOutput] = useState<string | null>(null)
  const [testLatency, setTestLatency] = useState<number | null>(null)

  // 1. Fetch prompt configurations
  const { data: prompts = [], isLoading } = useQuery<PromptConfig[]>({
    queryKey: ["admin-prompts"],
    queryFn: () => fetchJson<PromptConfig[]>("/api/backend/admin/prompts"),
  })

  // 2. Fetch recent test runs
  const { refetch: refetchRuns } = useQuery<PromptTestRun[]>({
    queryKey: ["admin-prompt-runs"],
    queryFn: () => fetchJson<PromptTestRun[]>("/api/backend/admin/prompts/test-runs"),
  })

  const currentPromptConfig = prompts.find((p) => p.name === selectedPromptName) || prompts[0]

  const systemPrompt = systemPromptOverride ?? currentPromptConfig?.system_prompt ?? ""
  const userPrompt = userPromptOverride ?? currentPromptConfig?.user_prompt ?? ""

  const handleSelectPrompt = (name: string) => {
    setSelectedPromptName(name)
    setSystemPromptOverride(null)
    setUserPromptOverride(null)
  }

  // Save prompt mutation
  const savePromptMutation = useMutation({
    mutationFn: async () => {
      return fetchJson("/api/backend/admin/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: selectedPromptName,
          system_prompt: systemPrompt,
          user_prompt: userPrompt || null,
        }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-prompts"] })
      alert("Prompt configuration saved successfully!")
    },
    onError: (err: Error) => {
      alert(`Save failed: ${err.message}`)
    },
  })

  // Run test playground mutation with safe JSON parsing
  const runTestMutation = useMutation({
    mutationFn: async () => {
      setJsonError(null)
      let parsedVars = {}
      if (variablesInput.trim()) {
        try {
          parsedVars = JSON.parse(variablesInput)
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e)
          throw new Error(`Invalid JSON in Variables: ${err}`)
        }
      }

      return fetchJson<{ output: string; latency_ms: number }>("/api/backend/admin/prompts/playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt_name: selectedPromptName,
          system_prompt: systemPrompt,
          user_prompt: userPrompt || null,
          variables: parsedVars,
        }),
      })
    },
    onSuccess: (data) => {
      setTestOutput(data.output)
      setTestLatency(data.latency_ms)
      refetchRuns()
    },
    onError: (err: Error) => {
      setJsonError(err.message)
    },
  })

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
      {/* Left Sidebar: Prompt Selection List */}
      <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-[2px_2px_0px_#000000]">
        <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 pb-3">
          <Settings size={16} className="text-[#ff4e26]" />
          <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-white">
            Configured Nodes
          </h3>
        </div>

        <div className="mt-3 space-y-1">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="h-8 border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 animate-pulse" />
              ))}
            </div>
          ) : (
            prompts.map((p) => {
              const isSelected = p.name === selectedPromptName
              return (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => handleSelectPrompt(p.name)}
                  className={`w-full text-left px-3 py-2 font-mono text-xs font-bold uppercase transition-all ${
                    isSelected
                      ? "bg-[#ff4e26] text-white border-l-4 border-white shadow-[2px_2px_0px_#000000]"
                      : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 border-l-4 border-transparent hover:text-black dark:hover:text-white"
                  }`}
                >
                  <div className="truncate">{p.name}</div>
                  {p.updated_at && (
                    <div className="text-[9px] text-zinc-400 font-normal">
                      {new Date(p.updated_at).toLocaleDateString()}
                    </div>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Center & Right: Editor & Test Sandbox */}
      <div className="lg:col-span-3 space-y-6">
        {/* Editor Box */}
        <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-[2px_2px_0px_#000000] space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
            <div>
              <span className="font-mono text-[10px] font-bold text-[#ff4e26] uppercase">Node Prompt</span>
              <h2 className="text-sm font-bold uppercase text-zinc-900 dark:text-white font-mono">
                {selectedPromptName}
              </h2>
            </div>

            <button
              type="button"
              onClick={() => savePromptMutation.mutate()}
              disabled={savePromptMutation.isPending}
              className="flex items-center gap-1.5 border border-black dark:border-white bg-[#ff4e26] px-4 py-2 font-mono text-xs font-bold uppercase text-white shadow-[2px_2px_0px_#000000] hover:bg-[#e03d16] disabled:opacity-50 transition-all"
            >
              <Save size={14} />
              <span>{savePromptMutation.isPending ? "Saving..." : "Save Prompt"}</span>
            </button>
          </div>

          <div className="space-y-4 font-mono text-xs">
            <div>
              <label className="block text-zinc-500 font-bold uppercase mb-1">
                System Prompt (Core Instructions &amp; Constraints)
              </label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPromptOverride(e.target.value)}
                rows={10}
                className="w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 p-3 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:border-[#ff4e26] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-zinc-500 font-bold uppercase mb-1">
                User Prompt Template (Optional - Variable Placeholders Supported)
              </label>
              <textarea
                value={userPrompt}
                onChange={(e) => setUserPromptOverride(e.target.value)}
                rows={4}
                placeholder="e.g. Please analyze the following candidate profile for {{job_title}} at {{company}}..."
                className="w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 p-3 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:border-[#ff4e26] focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Live Playground / Test Runner */}
        <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-[2px_2px_0px_#000000] space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
            <div className="flex items-center gap-2">
              <Play size={16} className="text-[#ff4e26]" />
              <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-white">
                Live Test Execution Runner
              </h3>
            </div>

            <button
              type="button"
              onClick={() => runTestMutation.mutate()}
              disabled={runTestMutation.isPending}
              className="flex items-center gap-1.5 border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 font-mono text-xs font-bold uppercase text-zinc-900 dark:text-white hover:border-[#ff4e26] hover:text-[#ff4e26] disabled:opacity-50 transition-colors"
            >
              <Sparkles size={13} className={runTestMutation.isPending ? "animate-spin" : ""} />
              <span>{runTestMutation.isPending ? "Executing LLM..." : "Run Test"}</span>
            </button>
          </div>

          <div className="space-y-3 font-mono text-xs">
            <div>
              <label className="block text-zinc-500 font-bold uppercase mb-1">
                JSON Variables Payload
              </label>
              <textarea
                value={variablesInput}
                onChange={(e) => setVariablesInput(e.target.value)}
                rows={4}
                className="w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 p-2.5 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:border-[#ff4e26] focus:outline-none"
              />
            </div>

            {jsonError && (
              <div className="border border-red-800 bg-red-950/60 p-3 text-xs text-red-300 font-mono">
                <strong>Execution Error:</strong> {jsonError}
              </div>
            )}

            {testOutput && (
              <div className="space-y-1">
                <div className="flex justify-between text-zinc-500 text-[11px]">
                  <span>LLM Output Stream</span>
                  {testLatency != null && <span>Latency: {testLatency}ms</span>}
                </div>
                <div className="max-h-[300px] overflow-y-auto border border-zinc-300 dark:border-zinc-700 bg-black p-3 text-xs font-mono text-emerald-400 whitespace-pre-wrap">
                  {testOutput}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
