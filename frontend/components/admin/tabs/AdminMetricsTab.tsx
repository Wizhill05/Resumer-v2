"use client"

import React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Layers,
  RefreshCw,
} from "lucide-react"
import { MetricSummary, MetricNode } from "../types"

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Fetch failed: ${res.statusText}`)
  return res.json()
}

export function AdminMetricsTab() {
  const { data: summary, isFetching, refetch } = useQuery<MetricSummary>({
    queryKey: ["admin-metrics-summary"],
    queryFn: () => fetchJson<MetricSummary>("/api/backend/admin/metrics/summary"),
  })

  const { data: nodes = [], isLoading: loadingNodes } = useQuery<MetricNode[]>({
    queryKey: ["admin-metrics-nodes"],
    queryFn: () => fetchJson<MetricNode[]>("/api/backend/admin/metrics/nodes"),
  })

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-[2px_2px_0px_#000000]">
        <div>
          <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-[#ff4e26]">
            LLM Execution &amp; Node Telemetry
          </h2>
          <p className="text-xs text-zinc-500">
            Node-level latency profiling, token consumption aggregates, and error recovery metrics.
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

      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 font-mono text-xs">
        <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 border-l-4 border-blue-500 shadow-[2px_2px_0px_#000000]">
          <span className="text-zinc-500 text-[10px] uppercase font-bold block">Total Tokens</span>
          <span className="text-xl font-black text-zinc-900 dark:text-white mt-1 block">
            {summary ? summary.total_tokens.toLocaleString() : "-"}
          </span>
          <span className="text-[10px] text-zinc-400 mt-1 block">Prompt + Completion</span>
        </div>

        <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 border-l-4 border-emerald-500 shadow-[2px_2px_0px_#000000]">
          <span className="text-zinc-500 text-[10px] uppercase font-bold block">Avg Node Latency</span>
          <span className="text-xl font-black text-zinc-900 dark:text-white mt-1 block">
            {summary ? `${summary.average_node_latency_ms}ms` : "-"}
          </span>
          <span className="text-[10px] text-zinc-400 mt-1 block">Across all nodes</span>
        </div>

        <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 border-l-4 border-amber-500 shadow-[2px_2px_0px_#000000]">
          <span className="text-zinc-500 text-[10px] uppercase font-bold block">Fallbacks</span>
          <span className="text-xl font-black text-amber-500 mt-1 block">
            {summary ? summary.fallback_count.toLocaleString() : "-"}
          </span>
          <span className="text-[10px] text-zinc-400 mt-1 block">Secondary invocations</span>
        </div>

        <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 border-l-4 border-red-500 shadow-[2px_2px_0px_#000000]">
          <span className="text-zinc-500 text-[10px] uppercase font-bold block">JSON Parse Errors</span>
          <span className="text-xl font-black text-red-500 mt-1 block">
            {summary ? summary.parse_error_count.toLocaleString() : "-"}
          </span>
          <span className="text-[10px] text-zinc-400 mt-1 block">Structured output errors</span>
        </div>

        <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 border-l-4 border-purple-500 shadow-[2px_2px_0px_#000000]">
          <span className="text-zinc-500 text-[10px] uppercase font-bold block">Recorded Calls</span>
          <span className="text-xl font-black text-[#ff4e26] mt-1 block">
            {summary ? summary.recorded_calls.toLocaleString() : "-"}
          </span>
          <span className="text-[10px] text-zinc-400 mt-1 block">LLM executions</span>
        </div>
      </div>

      {/* Node Breakdown Table */}
      <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-[2px_2px_0px_#000000]">
        <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 pb-3">
          <Layers size={16} className="text-[#ff4e26]" />
          <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-white">
            Node-by-Node Profiling &amp; Reliability
          </h3>
        </div>

        <div className="mt-4 overflow-x-auto">
          {loadingNodes ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="h-10 border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 animate-pulse" />
              ))}
            </div>
          ) : nodes.length === 0 ? (
            <div className="p-8 text-center font-mono text-xs text-zinc-500">
              No node metrics recorded yet.
            </div>
          ) : (
            <table className="w-full text-left font-mono text-xs">
              <thead className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-[11px] text-zinc-500 uppercase">
                <tr>
                  <th className="py-2.5 px-3">Node Name</th>
                  <th className="py-2.5 px-3">Provider</th>
                  <th className="py-2.5 px-3">Calls</th>
                  <th className="py-2.5 px-3">Avg Latency</th>
                  <th className="py-2.5 px-3">Errors</th>
                  <th className="py-2.5 px-3">Fallbacks</th>
                  <th className="py-2.5 px-3">Parse Errors</th>
                  <th className="py-2.5 px-3">Total Tokens</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {nodes.map((node) => (
                  <tr key={`${node.node_name}-${node.provider}`} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="py-2.5 px-3 font-bold text-zinc-900 dark:text-white uppercase">
                      {node.node_name}
                    </td>
                    <td className="py-2.5 px-3 text-zinc-500">{node.provider}</td>
                    <td className="py-2.5 px-3 text-zinc-700 dark:text-zinc-300 font-semibold">
                      {node.calls.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-[#ff4e26] font-semibold">
                      {node.average_latency_ms}ms
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={node.errors > 0 ? "font-bold text-red-500" : "text-zinc-400"}>
                        {node.errors}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={node.fallbacks > 0 ? "font-bold text-amber-500" : "text-zinc-400"}>
                        {node.fallbacks}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={node.parse_errors > 0 ? "font-bold text-red-500" : "text-zinc-400"}>
                        {node.parse_errors}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-zinc-800 dark:text-zinc-200">
                      {node.total_tokens.toLocaleString()}
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
