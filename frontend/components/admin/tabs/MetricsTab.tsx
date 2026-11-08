"use client"

import { useQuery } from "@tanstack/react-query"
import type { MetricNode, MetricSummary } from "../api-types"
import { Panel, Skeleton, Stat, fetchJson, formatNumber } from "../shared"

export function MetricsTab() {
  const { data: summary, isLoading } = useQuery<MetricSummary>({
    queryKey: ["admin", "metrics", "summary"],
    queryFn: () => fetchJson<MetricSummary>("/api/backend/admin/metrics/summary"),
  })
  const { data: nodes = [] } = useQuery<MetricNode[]>({
    queryKey: ["admin", "metrics", "nodes"],
    queryFn: () => fetchJson<MetricNode[]>("/api/backend/admin/metrics/nodes"),
  })

  if (isLoading) return <Skeleton className="h-48" />

  return (
    <div className="space-y-4 pixel-enter">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Calls" value={formatNumber(summary?.recorded_calls ?? 0)} />
        <Stat label="Tokens" value={formatNumber(summary?.total_tokens ?? 0)} />
        <Stat label="Avg latency" value={`${summary?.average_node_latency_ms ?? 0}ms`} />
        <Stat label="Fallbacks" value={<span className="text-amber-600">{summary?.fallback_count ?? 0}</span>} />
        <Stat label="Parse errors" value={<span className="text-red-600">{summary?.parse_error_count ?? 0}</span>} />
      </div>

      <ul className="space-y-3 md:hidden">
        {nodes.map((row) => (
          <li key={`${row.node_name}-${row.provider}`} className="panel-strong p-3">
            <p className="break-all text-sm font-bold">{row.node_name}</p>
            <p className="text-[11px] text-zinc-500">{row.provider}</p>
            <dl className="mt-2 grid grid-cols-3 gap-2 font-mono text-[11px]">
              <div><dt className="font-sans text-zinc-500">Calls</dt><dd>{row.calls}</dd></div>
              <div><dt className="font-sans text-zinc-500">Latency</dt><dd>{row.average_latency_ms}ms</dd></div>
              <div><dt className="font-sans text-zinc-500">Tokens</dt><dd>{formatNumber(row.total_tokens)}</dd></div>
              <div className="col-span-3"><dt className="font-sans text-zinc-500">Problems</dt><dd>{row.errors} errors · {row.fallbacks} fallbacks · {row.parse_errors} parse</dd></div>
            </dl>
          </li>
        ))}
      </ul>
      <Panel className="hidden overflow-x-auto p-0 sm:p-0 md:block">
        <table className="w-full text-left text-xs">
          <thead className="bg-zinc-100 font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            <tr><th className="p-3">Node</th><th className="p-3">Provider</th><th className="p-3">Calls</th><th className="p-3">Avg latency</th><th className="p-3">Problems</th><th className="p-3">Tokens</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
            {nodes.map((row) => (
              <tr key={`${row.node_name}-${row.provider}`}>
                <td className="p-3 font-bold">{row.node_name}</td>
                <td className="p-3">{row.provider}</td>
                <td className="p-3">{row.calls}</td>
                <td className="p-3">{row.average_latency_ms}ms</td>
                <td className="p-3">{row.errors} errors · {row.fallbacks} fallbacks · {row.parse_errors} parse</td>
                <td className="p-3">{formatNumber(row.total_tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  )
}
