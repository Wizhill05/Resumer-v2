"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Activity, Cpu, Layers, Play, Terminal, Timer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { GenerationItem, SlowestRunItem, TimingByModelResponse } from "../api-types"
import { FIELD_CLASS, Note, Panel, PanelHeader, RefreshButton, Skeleton, Stat, fetchJson } from "../shared"

const shortModel = (name: string) => (name.includes("/") ? name.split("/").slice(1).join("/") : name)

function speedTone(seconds: number) {
  if (seconds > 90) return "text-red-600 dark:text-red-400 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40"
  if (seconds > 45) return "text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40"
  return "text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40"
}

function asGeneration(run: SlowestRunItem): GenerationItem {
  return {
    id: run.id,
    user_id: "",
    template_id: run.template_id,
    job_title: run.job_title,
    company: run.company,
    model_used: run.model_used,
    status: "completed",
    created_at: run.created_at,
    completed_at: run.completed_at,
    duration_seconds: run.duration_seconds,
    is_guest: false,
    intermediate_resume_count: 0,
  }
}

export function TimingTab({ onWaterfall, onLogs }: { onWaterfall: (gen: GenerationItem) => void; onLogs: (id: string) => void }) {
  const [filter, setFilter] = useState("")
  const { data, isLoading, isFetching, refetch } = useQuery<TimingByModelResponse>({
    queryKey: ["admin", "timing-by-model"],
    queryFn: () => fetchJson<TimingByModelResponse>("/api/backend/admin/metrics/timing-by-model"),
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    )
  }
  if (!data) return <Note>No timing telemetry recorded yet.</Note>

  const models = data.models_benchmark || []
  const done = models.filter((m) => m.completed_runs > 0 && m.avg_duration_seconds > 0)
  const fastest = [...done].sort((a, b) => a.avg_duration_seconds - b.avg_duration_seconds)[0]
  const slowest = [...done].sort((a, b) => b.avg_duration_seconds - a.avg_duration_seconds)[0]
  const totalRuns = models.reduce((acc, m) => acc + m.total_runs, 0)
  const totalTokens = models.reduce((acc, m) => acc + m.total_tokens, 0)
  const visible = models.filter((m) => !filter || m.model_name.toLowerCase().includes(filter.toLowerCase()))

  return (
    <div className="space-y-5 pixel-enter">
      <div className="flex justify-end">
        <RefreshButton onClick={() => refetch()} busy={isFetching} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Fastest model" value={<span className="block truncate text-lg text-emerald-700 dark:text-emerald-400">{fastest ? shortModel(fastest.model_name) : "N/A"}</span>} sub={fastest ? `${fastest.avg_duration_seconds}s average` : undefined} />
        <Stat label="Slowest model" value={<span className="block truncate text-lg text-amber-700 dark:text-amber-400">{slowest ? shortModel(slowest.model_name) : "N/A"}</span>} sub={slowest ? `${slowest.avg_duration_seconds}s average` : undefined} />
        <Stat label="Benchmarked builds" value={totalRuns.toLocaleString()} accent sub={`Across ${models.length} models`} />
        <Stat label="Tokens tracked" value={totalTokens.toLocaleString()} sub="Pipeline telemetry" />
      </div>

      <Panel>
        <PanelHeader
          title="Model benchmarks"
          icon={<Cpu size={15} className="text-[#ff4e26]" />}
          aside={<input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter models" aria-label="Filter models" className={cn(FIELD_CLASS, "w-full sm:w-52")} />}
        />
        <ul className="space-y-2 md:hidden">
          {visible.map((m) => (
            <li key={m.model_name} className="border border-zinc-200 p-3 dark:border-zinc-700">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-all text-sm font-extrabold text-black dark:text-white">{shortModel(m.model_name)}</p>
                  <p className="text-[11px] text-zinc-500">{m.total_runs} builds · {m.completed_runs} ok · {m.failed_runs} failed</p>
                </div>
                <span className={cn("shrink-0 border px-2 py-0.5 font-mono text-xs font-bold", speedTone(m.avg_duration_seconds))}>{m.avg_duration_seconds ? `${m.avg_duration_seconds}s` : "--"}</span>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px]">
                <div><dt className="font-sans text-zinc-500">p50 / p90</dt><dd>{m.p50_duration_seconds || "--"}s / {m.p90_duration_seconds || "--"}s</dd></div>
                <div><dt className="font-sans text-zinc-500">Range</dt><dd>{m.min_duration_seconds}s → {m.max_duration_seconds}s</dd></div>
                <div><dt className="font-sans text-zinc-500">Fail rate</dt><dd className={m.failure_rate > 5 ? "text-red-600" : "text-emerald-700"}>{m.failure_rate}%</dd></div>
                <div><dt className="font-sans text-zinc-500">Tokens</dt><dd>{m.total_tokens ? m.total_tokens.toLocaleString() : "--"}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto border border-zinc-200 dark:border-zinc-700 md:block">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-100 font-bold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                <th className="p-3">Model</th>
                <th className="p-3 text-center">Volume</th>
                <th className="p-3">Average</th>
                <th className="p-3">p50 / p90</th>
                <th className="p-3">Range</th>
                <th className="p-3 text-center">Fail rate</th>
                <th className="p-3 text-right">Tokens</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
              {visible.map((m) => (
                <tr key={m.model_name} className="font-mono hover:bg-zinc-50 dark:hover:bg-zinc-800">
                  <td className="p-3">
                    <p className="font-sans text-xs font-extrabold text-black dark:text-white">{shortModel(m.model_name)}</p>
                    <p className="max-w-xs truncate text-[10px] text-zinc-400" title={m.model_name}>{m.model_name}</p>
                  </td>
                  <td className="p-3 text-center"><span className="font-extrabold">{m.total_runs}</span><span className="block font-sans text-[10px] text-zinc-400">{m.completed_runs} ok · {m.failed_runs} fail</span></td>
                  <td className="p-3"><span className={cn("border px-2 py-0.5 text-xs font-bold", speedTone(m.avg_duration_seconds))}>{m.avg_duration_seconds ? `${m.avg_duration_seconds}s` : "--"}</span></td>
                  <td className="p-3 text-[11px]">{m.p50_duration_seconds || "--"}s / {m.p90_duration_seconds || "--"}s</td>
                  <td className="p-3 text-[10px] text-zinc-500">{m.min_duration_seconds}s → {m.max_duration_seconds}s</td>
                  <td className={cn("p-3 text-center font-bold", m.failure_rate > 5 ? "text-red-600" : "text-emerald-700")}>{m.failure_rate}%</td>
                  <td className="p-3 text-right font-bold">{m.total_tokens ? m.total_tokens.toLocaleString() : "--"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Template speed" icon={<Play size={14} className="text-[#ff4e26]" />} />
          <ul className="space-y-2">
            {data.templates_benchmark.map((tpl) => (
              <li key={tpl.template_id} className="flex items-center justify-between gap-3 border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/60">
                <div className="min-w-0">
                  <p className="break-all text-xs font-extrabold text-black dark:text-white">{tpl.template_id}</p>
                  <p className="font-mono text-[10px] text-zinc-500">{tpl.total_runs} completed</p>
                </div>
                <p className="shrink-0 text-right font-mono text-sm font-extrabold text-black dark:text-white">{tpl.avg_duration_seconds}s<span className="block text-[10px] font-normal text-zinc-400">average</span></p>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <PanelHeader title="Node latency" icon={<Layers size={14} className="text-[#ff4e26]" />} hint="Top 15 node and model pairs" />
          <ul className="max-h-[22rem] divide-y divide-zinc-200 overflow-y-auto border border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
            {data.nodes_by_model.slice(0, 15).map((node, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="break-all text-xs font-bold text-black dark:text-white">{node.node_name}</p>
                  <p className="truncate font-mono text-[10px] text-zinc-400" title={node.model}>{node.model}</p>
                </div>
                <p className="shrink-0 text-right font-mono text-[11px]"><span className="font-bold">{(node.avg_latency_ms / 1000).toFixed(2)}s</span><span className="block text-zinc-500">{node.calls} calls</span></p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Slowest generations" icon={<Activity size={15} className="text-red-500" />} hint="Ranked by duration" />
        <ul className="divide-y divide-zinc-200 border border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
          {data.slowest_runs.map((run) => (
            <li key={run.id} className="space-y-2 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-xs font-extrabold text-black dark:text-white">{run.job_title}</p>
                  <p className="[overflow-wrap:anywhere] text-[11px] text-zinc-500">{run.company} · {run.email}</p>
                  <p className="mt-0.5 break-all font-mono text-[10px] text-zinc-500">{run.model_used} · {run.template_id} · {new Date(run.created_at).toLocaleDateString()}</p>
                </div>
                <p className="shrink-0 font-mono text-sm font-bold text-red-600 dark:text-red-400">{run.duration_seconds}s</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="min-h-11 sm:min-h-8" onClick={() => onWaterfall(asGeneration(run))}><Timer size={12} className="text-[#ff4e26]" /> Waterfall</Button>
                <Button size="sm" variant="outline" className="min-h-11 sm:min-h-8" onClick={() => onLogs(run.id)}><Terminal size={12} /> Logs</Button>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}
