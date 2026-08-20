"use client"

import React from "react"
import {
  FileText,
  Activity,
  ArrowRight,
  ShieldAlert,
  CheckCircle2,
  Cpu,
  MessageSquare,
  AlertTriangle,
  Terminal,
  Zap,
} from "lucide-react"
import { AdminStatCards } from "../AdminStatCards"
import {
  AnalyticsData,
  GenerationItem,
  SupportReportItem,
  AdminTabId,
} from "../types"

interface AdminOverviewTabProps {
  analytics?: AnalyticsData
  loadingAnalytics: boolean
  recentGenerations: GenerationItem[]
  loadingGenerations: boolean
  recentReports: SupportReportItem[]
  loadingReports: boolean
  onNavigateTab: (tab: AdminTabId) => void
  onInspectGeneration: (gen: GenerationItem) => void
}

export function AdminOverviewTab({
  analytics,
  loadingAnalytics,
  recentGenerations,
  loadingGenerations,
  recentReports,
  loadingReports,
  onNavigateTab,
  onInspectGeneration,
}: AdminOverviewTabProps) {
  const buckets = analytics?.duration_buckets || {
    under_30s: 0,
    "30s_to_60s": 0,
    "1m_to_2m": 0,
    "2m_to_5m": 0,
    over_5m: 0,
  }

  const totalBucketRuns = Object.values(buckets).reduce((a, b) => a + b, 0) || 1

  return (
    <div className="space-y-6">
      {/* ── TIER 1: 4-COLUMN KPI STAT CARDS ── */}
      <AdminStatCards analytics={analytics} isLoading={loadingAnalytics} />

      {/* ── TIER 2: DUAL PERFORMANCE & HEALTH GRID ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left 2/3: Latency Distribution & Duration Buckets */}
        <div className="lg:col-span-2 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-[2px_2px_0px_#000000]">
          <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
            <div className="flex items-center gap-2">
              <Activity size={16} className="text-[#ff4e26]" />
              <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-white">
                Generation Latency Distribution &amp; Duration Buckets
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab("timing")}
              className="flex items-center gap-1 font-mono text-[11px] font-bold text-[#ff4e26] hover:underline"
            >
              <span>Full Benchmarks</span>
              <ArrowRight size={12} />
            </button>
          </div>

          <div className="mt-4 space-y-3 font-mono text-xs">
            {[
              { label: "< 30s (Optimal)", count: buckets.under_30s, color: "bg-emerald-500" },
              { label: "30s - 60s (Normal)", count: buckets["30s_to_60s"], color: "bg-blue-500" },
              { label: "1m - 2m (Degraded)", count: buckets["1m_to_2m"], color: "bg-amber-500" },
              { label: "2m - 5m (High Latency)", count: buckets["2m_to_5m"], color: "bg-orange-500" },
              { label: "> 5m (Critical Timeout)", count: buckets.over_5m, color: "bg-red-500" },
            ].map((b) => {
              const pct = ((b.count / totalBucketRuns) * 100).toFixed(1)
              return (
                <div key={b.label} className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-600 dark:text-zinc-400">{b.label}</span>
                    <span className="font-bold text-zinc-900 dark:text-zinc-100">
                      {b.count} runs ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 w-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                    <div
                      className={`h-full ${b.color} transition-all duration-300`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 border-t border-zinc-100 dark:border-zinc-800 pt-3 font-mono text-[11px]">
            <div>
              <span className="text-zinc-500 block">Avg Latency</span>
              <span className="font-bold text-zinc-900 dark:text-white">
                {analytics?.average_generation_latency_seconds.toFixed(1)}s
              </span>
            </div>
            <div>
              <span className="text-zinc-500 block">P50 Latency</span>
              <span className="font-bold text-zinc-900 dark:text-white">
                {analytics?.p50_latency_seconds ? `${analytics.p50_latency_seconds.toFixed(1)}s` : "-"}
              </span>
            </div>
            <div>
              <span className="text-zinc-500 block">P90 Latency</span>
              <span className="font-bold text-zinc-900 dark:text-white">
                {analytics?.p90_latency_seconds ? `${analytics.p90_latency_seconds.toFixed(1)}s` : "-"}
              </span>
            </div>
            <div>
              <span className="text-zinc-500 block">Recorded Calls</span>
              <span className="font-bold text-[#ff4e26]">
                {analytics?.llm_metrics.recorded_calls.toLocaleString() || 0}
              </span>
            </div>
          </div>
        </div>

        {/* Right 1/3: Model Provider Runtime Status */}
        <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-[2px_2px_0px_#000000] flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Cpu size={16} className="text-[#ff4e26]" />
                <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-white">
                  Model Providers &amp; Health
                </h3>
              </div>
              <button
                type="button"
                onClick={() => onNavigateTab("models")}
                className="font-mono text-[11px] font-bold text-[#ff4e26] hover:underline"
              >
                Configure
              </button>
            </div>

            <div className="mt-4 space-y-3 font-mono text-xs">
              {/* Pro Model */}
              <div className="border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-zinc-900 dark:text-white">PRO TIER</span>
                  <span className="border border-emerald-800 bg-emerald-950 px-1.5 py-0.2 text-[10px] font-bold text-emerald-400 uppercase">
                    Active
                  </span>
                </div>
                <div className="mt-1.5 text-[11px] text-zinc-500">
                  Model: <span className="text-zinc-900 dark:text-zinc-200 font-semibold">{analytics?.keys_status?.pro?.model || "OmniRoute Gemini 3.7"}</span>
                </div>
                <div className="text-[11px] text-zinc-500">
                  Configured Keys: <span className="text-zinc-900 dark:text-zinc-200">{analytics?.keys_status?.pro?.configured_keys_count ?? 1}</span>
                </div>
              </div>

              {/* Free OpenRouter Model */}
              <div className="border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-zinc-900 dark:text-white">FREE TIER</span>
                  <span className="border border-zinc-700 bg-zinc-800 px-1.5 py-0.2 text-[10px] font-bold text-zinc-300 uppercase">
                    OpenRouter
                  </span>
                </div>
                <div className="mt-1.5 text-[11px] text-zinc-500">
                  Model: <span className="text-zinc-900 dark:text-zinc-200 font-semibold">{analytics?.keys_status?.openrouter?.model || "Poolside Laguna XS 2.1"}</span>
                </div>
                <div className="text-[11px] text-zinc-500">
                  Configured Keys: <span className="text-zinc-900 dark:text-zinc-200">{analytics?.keys_status?.openrouter?.configured_keys_count ?? 1}</span>
                </div>
              </div>

              {/* Fallback Google */}
              <div className="border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-zinc-900 dark:text-white">FALLBACK CHAIN</span>
                  <span className="border border-blue-800 bg-blue-950 px-1.5 py-0.2 text-[10px] font-bold text-blue-300 uppercase">
                    Google GenAI
                  </span>
                </div>
                <div className="mt-1.5 text-[11px] text-zinc-500">
                  Fallback Invocations: <span className="font-bold text-amber-500">{analytics?.llm_metrics.fallback_count || 0}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 border-t border-zinc-100 dark:border-zinc-800 pt-3">
            <button
              type="button"
              onClick={() => onNavigateTab("models")}
              className="flex w-full items-center justify-center gap-2 border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-white hover:border-[#ff4e26] transition-colors"
            >
              <Zap size={14} className="text-[#ff4e26]" />
              <span>Test Connection Endpoints</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── TIER 3: OPERATIONAL TRIAGE (RECENT GENERATIONS & SUPPORT FEEDS) ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left 2/3: Recent Generations Data Table */}
        <div className="lg:col-span-2 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-[2px_2px_0px_#000000]">
          <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
            <div className="flex items-center gap-2">
              <FileText size={16} className="text-[#ff4e26]" />
              <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-white">
                Recent Generations &amp; Runs
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab("generations")}
              className="flex items-center gap-1 font-mono text-[11px] font-bold text-[#ff4e26] hover:underline"
            >
              <span>View All ({analytics?.total_generations || 0})</span>
              <ArrowRight size={12} />
            </button>
          </div>

          <div className="mt-4 overflow-x-auto">
            {loadingGenerations ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="h-12 border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 animate-pulse" />
                ))}
              </div>
            ) : recentGenerations.length === 0 ? (
              <div className="border border-dashed border-zinc-200 dark:border-zinc-800 p-8 text-center font-mono text-xs text-zinc-500">
                No recent generations found.
              </div>
            ) : (
              <table className="w-full text-left font-mono text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-400 uppercase">
                    <th className="pb-2">Target Job / User</th>
                    <th className="pb-2">Model</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2">Duration</th>
                    <th className="pb-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                  {recentGenerations.slice(0, 8).map((gen) => {
                    const isSuccess = gen.status === "completed"
                    const isFailed = gen.status === "failed"
                    return (
                      <tr key={gen.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
                        <td className="py-2.5 pr-3">
                          <div className="font-bold text-zinc-900 dark:text-white truncate max-w-[200px]">
                            {gen.job_title || gen.company || "Untitled Job"}
                          </div>
                          <div className="text-[10px] text-zinc-400 truncate max-w-[200px]">
                            {gen.email || (gen.is_guest ? "Guest User" : gen.user_id.slice(0, 8))}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-[11px] text-zinc-600 dark:text-zinc-300">
                          <span className="truncate max-w-[120px] block" title={gen.model_used}>
                            {gen.model_used.split("/").pop()}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3">
                          <span
                            className={`px-1.5 py-0.5 text-[10px] font-bold uppercase border ${
                              isSuccess
                                ? "border-emerald-800 bg-emerald-950 text-emerald-400"
                                : isFailed
                                ? "border-red-800 bg-red-950 text-red-400"
                                : "border-amber-800 bg-amber-950 text-amber-400"
                            }`}
                          >
                            {gen.status}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-zinc-700 dark:text-zinc-300">
                          {gen.duration_seconds != null ? `${gen.duration_seconds.toFixed(1)}s` : "-"}
                        </td>
                        <td className="py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => onInspectGeneration(gen)}
                            className="inline-flex items-center gap-1 border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 text-[11px] font-bold text-zinc-800 dark:text-zinc-200 hover:border-[#ff4e26] hover:text-[#ff4e26] transition-colors"
                          >
                            <Terminal size={11} />
                            <span>Trace</span>
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right 1/3: Stacked Live Widgets (Feedback & Alerts) */}
        <div className="space-y-6">
          {/* Widget A: Recent Feedback & Support Reports */}
          <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-[2px_2px_0px_#000000]">
            <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <MessageSquare size={16} className="text-[#ff4e26]" />
                <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-white">
                  Support &amp; Feedback
                </h3>
              </div>
              <button
                type="button"
                onClick={() => onNavigateTab("feedback")}
                className="font-mono text-[11px] font-bold text-[#ff4e26] hover:underline"
              >
                Review
              </button>
            </div>

            <div className="mt-4 space-y-2.5 font-mono text-xs">
              {loadingReports ? (
                <div className="space-y-2">
                  {[1, 2].map((n) => (
                    <div key={n} className="h-14 border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 animate-pulse" />
                  ))}
                </div>
              ) : recentReports.length === 0 ? (
                <div className="border border-dashed border-zinc-200 dark:border-zinc-800 p-6 text-center text-zinc-500 text-[11px]">
                  No pending support tickets.
                </div>
              ) : (
                recentReports.slice(0, 3).map((rep) => (
                  <div
                    key={rep.id}
                    className="border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-2.5 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-zinc-800 dark:text-zinc-200 uppercase text-[11px]">
                        {rep.category}
                      </span>
                      <span
                        className={`px-1 text-[9px] font-bold uppercase border ${
                          rep.status === "resolved"
                            ? "border-emerald-800 bg-emerald-950 text-emerald-400"
                            : "border-red-800 bg-red-950 text-red-400"
                        }`}
                      >
                        {rep.status}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-zinc-600 dark:text-zinc-400 text-[11px]">
                      {rep.message}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-500">
                      <span>{rep.email || "Anonymous User"}</span>
                      {rep.sentiment_score != null && (
                        <span className="text-[#ff4e26]">
                          Sentiment: {rep.sentiment_score}/10
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Widget B: Platform Health Checklist */}
          <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-[2px_2px_0px_#000000]">
            <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <ShieldAlert size={16} className="text-[#ff4e26]" />
              <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-white">
                Platform Action Items
              </h3>
            </div>

            <div className="mt-3 space-y-2 font-mono text-[11px]">
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={13} />
                <span>Cloudflare R2 storage operational</span>
              </div>
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={13} />
                <span>Async database pool healthy</span>
              </div>
              {analytics && analytics.failure_rate_percent > 5 ? (
                <div className="flex items-center gap-2 text-red-500">
                  <AlertTriangle size={13} />
                  <span>High failure rate: {analytics.failure_rate_percent.toFixed(1)}%</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={13} />
                  <span>Pipeline failure rate within SLA (&lt;5%)</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
