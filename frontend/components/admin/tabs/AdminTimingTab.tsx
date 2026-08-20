"use client"

import React, { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Cpu,
  Layers,
  Zap,
  TrendingDown,
  Terminal,
  RefreshCw,
  Search,
} from "lucide-react"
import { TimingByModelResponse } from "../types"

interface AdminTimingTabProps {
  onInspectGenerationById: (id: string) => void
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Fetch failed: ${res.statusText}`)
  return res.json()
}

export function AdminTimingTab({ onInspectGenerationById }: AdminTimingTabProps) {
  const [modelSearch, setModelSearch] = useState("")

  const { data: timingData, isLoading, isFetching, refetch } = useQuery<TimingByModelResponse>({
    queryKey: ["admin-timing"],
    queryFn: () => fetchJson<TimingByModelResponse>("/api/backend/admin/analytics/timing-by-model"),
  })

  const models = timingData?.models_benchmark || []
  const templates = timingData?.templates_benchmark || []
  const nodes = timingData?.nodes_by_model || []
  const slowestRuns = timingData?.slowest_runs || []

  const filteredModels = modelSearch
    ? models.filter((m) => m.model_name.toLowerCase().includes(modelSearch.toLowerCase()))
    : models

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-[2px_2px_0px_#000000]">
        <div>
          <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-[#ff4e26]">
            Pipeline Performance Telemetry
          </h2>
          <p className="text-xs text-zinc-500">
            Per-model duration benchmarks, template latency comparisons, and slowest execution traces.
          </p>
        </div>

        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1 border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 font-mono text-xs font-bold uppercase text-zinc-800 dark:text-zinc-200 hover:border-[#ff4e26] transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={isFetching ? "animate-spin text-[#ff4e26]" : ""} />
          <span>Refresh Metrics</span>
        </button>
      </div>

      {/* SECTION 1: MODEL BENCHMARK TABLE */}
      <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-[2px_2px_0px_#000000]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <Cpu size={16} className="text-[#ff4e26]" />
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-white">
              Model Performance &amp; Duration Benchmarks
            </h3>
          </div>
          <div className="relative w-full sm:w-64">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
              placeholder="Filter by model name..."
              className="h-8 w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 pl-8 pr-2 text-xs font-mono text-zinc-900 dark:text-white placeholder-zinc-400 focus:border-[#ff4e26] focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-10 border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 animate-pulse" />
              ))}
            </div>
          ) : filteredModels.length === 0 ? (
            <div className="p-8 text-center font-mono text-xs text-zinc-500">
              No model benchmark records available yet.
            </div>
          ) : (
            <table className="w-full text-left font-mono text-xs">
              <thead className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-[11px] text-zinc-500 uppercase">
                <tr>
                  <th className="py-2.5 px-3">Model Name</th>
                  <th className="py-2.5 px-3">Runs</th>
                  <th className="py-2.5 px-3">Fail %</th>
                  <th className="py-2.5 px-3">Avg Duration</th>
                  <th className="py-2.5 px-3">P50</th>
                  <th className="py-2.5 px-3">P90</th>
                  <th className="py-2.5 px-3">Tokens</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {filteredModels.map((m) => (
                  <tr key={m.model_name} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
                    <td className="py-2.5 px-3 font-bold text-zinc-900 dark:text-white">
                      {m.model_name}
                    </td>
                    <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-300">
                      {m.total_runs} ({m.completed_runs} ok / {m.failed_runs} err)
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-1.5 py-0.5 text-[10px] font-bold uppercase border ${
                          m.failure_rate > 5
                            ? "border-red-800 bg-red-950 text-red-400"
                            : "border-emerald-800 bg-emerald-950 text-emerald-400"
                        }`}
                      >
                        {m.failure_rate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-zinc-800 dark:text-zinc-200 font-semibold">
                      {m.avg_duration_seconds.toFixed(1)}s
                    </td>
                    <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-400">
                      {m.p50_duration_seconds.toFixed(1)}s
                    </td>
                    <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-400">
                      {m.p90_duration_seconds.toFixed(1)}s
                    </td>
                    <td className="py-2.5 px-3 text-[#ff4e26]">
                      {m.total_tokens ? m.total_tokens.toLocaleString() : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* SECTION 2: TEMPLATE BENCHMARKS & NODE LATENCY MATRIX */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Templates Benchmark */}
        <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-[2px_2px_0px_#000000]">
          <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 pb-3">
            <Layers size={16} className="text-[#ff4e26]" />
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-white">
              Template Rendering Latency
            </h3>
          </div>

          <div className="mt-4 overflow-x-auto">
            {templates.length === 0 ? (
              <div className="p-6 text-center font-mono text-xs text-zinc-500">
                No template benchmarks available.
              </div>
            ) : (
              <table className="w-full text-left font-mono text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-400 uppercase">
                    <th className="pb-2">Template ID</th>
                    <th className="pb-2">Total Runs</th>
                    <th className="pb-2">Avg Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                  {templates.map((t) => (
                    <tr key={t.template_id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <td className="py-2 font-bold text-zinc-900 dark:text-white uppercase">
                        {t.template_id}
                      </td>
                      <td className="py-2 text-zinc-600 dark:text-zinc-300">{t.total_runs}</td>
                      <td className="py-2 font-semibold text-zinc-900 dark:text-zinc-200">
                        {t.avg_duration_seconds.toFixed(1)}s
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Node Model Latency Matrix */}
        <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-[2px_2px_0px_#000000]">
          <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 pb-3">
            <Zap size={16} className="text-[#ff4e26]" />
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-white">
              Node-by-Model Latency Breakdown
            </h3>
          </div>

          <div className="mt-4 overflow-x-auto max-h-[300px]">
            {nodes.length === 0 ? (
              <div className="p-6 text-center font-mono text-xs text-zinc-500">
                No node-level matrix data recorded.
              </div>
            ) : (
              <table className="w-full text-left font-mono text-xs">
                <thead className="border-b border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-400 uppercase sticky top-0 bg-white dark:bg-zinc-900">
                  <tr>
                    <th className="pb-2">Node</th>
                    <th className="pb-2">Model</th>
                    <th className="pb-2">Calls</th>
                    <th className="pb-2">Avg Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                  {nodes.map((n, i) => (
                    <tr key={`${n.node_name}-${n.model}-${i}`} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <td className="py-2 font-bold text-zinc-900 dark:text-white uppercase text-[11px]">
                        {n.node_name}
                      </td>
                      <td className="py-2 text-[11px] text-zinc-500 truncate max-w-[120px]" title={n.model}>
                        {n.model.split("/").pop()}
                      </td>
                      <td className="py-2 text-zinc-600 dark:text-zinc-300">{n.calls}</td>
                      <td className="py-2 text-[#ff4e26] font-semibold">{n.avg_latency_ms}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 3: TOP 10 SLOWEST RUNS */}
      <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-[2px_2px_0px_#000000]">
        <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 pb-3">
          <TrendingDown size={16} className="text-red-500" />
          <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-white">
            Top 10 Slowest Executions (Investigation Candidates)
          </h3>
        </div>

        <div className="mt-4 overflow-x-auto">
          {slowestRuns.length === 0 ? (
            <div className="p-8 text-center font-mono text-xs text-zinc-500">
              No slow runs recorded.
            </div>
          ) : (
            <table className="w-full text-left font-mono text-xs">
              <thead className="border-b border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-500 uppercase">
                <tr>
                  <th className="pb-2 px-2">Job Target / User</th>
                  <th className="pb-2 px-2">Model</th>
                  <th className="pb-2 px-2">Duration</th>
                  <th className="pb-2 px-2">Completed At</th>
                  <th className="pb-2 px-2 text-right">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {slowestRuns.map((run) => (
                  <tr key={run.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="py-2.5 px-2">
                      <div className="font-bold text-zinc-900 dark:text-white truncate max-w-[220px]">
                        {run.job_title || run.company || "Untitled Job"}
                      </div>
                      <div className="text-[10px] text-zinc-400">{run.email || "Guest"}</div>
                    </td>
                    <td className="py-2.5 px-2 text-zinc-600 dark:text-zinc-300">
                      {run.model_used.split("/").pop()}
                    </td>
                    <td className="py-2.5 px-2 font-mono font-bold text-red-500">
                      {run.duration_seconds.toFixed(1)}s
                    </td>
                    <td className="py-2.5 px-2 text-zinc-500 text-[11px]">
                      {run.completed_at ? new Date(run.completed_at).toLocaleString() : "-"}
                    </td>
                    <td className="py-2.5 px-2 text-right">
                      <button
                        type="button"
                        onClick={() => onInspectGenerationById(run.id)}
                        className="inline-flex items-center gap-1 border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 text-xs font-bold text-zinc-800 dark:text-zinc-200 hover:border-[#ff4e26] hover:text-[#ff4e26] transition-colors"
                      >
                        <Terminal size={11} />
                        <span>Trace</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
