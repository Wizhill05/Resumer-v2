"use client"

import React from "react"
import { Users, FileText, Activity, Timer } from "lucide-react"
import { AnalyticsData } from "./types"

interface AdminStatCardsProps {
  analytics?: AnalyticsData
  isLoading: boolean
}

export function AdminStatCards({ analytics, isLoading }: AdminStatCardsProps) {
  if (isLoading || !analytics) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((n) => (
          <div
            key={n}
            className="h-28 border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 animate-pulse"
          />
        ))}
      </div>
    )
  }

  const successRate = 100 - (analytics.failure_rate_percent || 0)
  const p50 = analytics.p50_latency_seconds
  const p90 = analytics.p90_latency_seconds
  const avg = analytics.average_generation_latency_seconds

  const cards = [
    {
      title: "Total Platform Users",
      value: analytics.total_users.toLocaleString(),
      subtext: "Registered user accounts",
      icon: Users,
      iconBg: "bg-blue-950/60 border-blue-800 text-blue-400",
      accent: "border-l-4 border-blue-500",
    },
    {
      title: "Total Generations",
      value: analytics.total_generations.toLocaleString(),
      subtext: `${analytics.total_guest_generations.toLocaleString()} guest runs`,
      icon: FileText,
      iconBg: "bg-amber-950/60 border-amber-800 text-amber-400",
      accent: "border-l-4 border-amber-500",
    },
    {
      title: "Pipeline Reliability",
      value: `${successRate.toFixed(1)}%`,
      subtext: `${analytics.failure_rate_percent.toFixed(1)}% failure rate`,
      icon: Activity,
      iconBg:
        successRate >= 95
          ? "bg-emerald-950/60 border-emerald-800 text-emerald-400"
          : "bg-red-950/60 border-red-800 text-red-400",
      accent: successRate >= 95 ? "border-l-4 border-emerald-500" : "border-l-4 border-red-500",
    },
    {
      title: "P50 / P90 Latency",
      value: p50 != null ? `${p50.toFixed(1)}s` : `${avg.toFixed(1)}s`,
      subtext: p90 != null ? `P90: ${p90.toFixed(1)}s (Avg: ${avg.toFixed(1)}s)` : `Avg: ${avg.toFixed(1)}s`,
      icon: Timer,
      iconBg: "bg-purple-950/60 border-purple-800 text-purple-400",
      accent: "border-l-4 border-purple-500",
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <div
            key={card.title}
            className={`flex flex-col justify-between border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-[2px_2px_0px_#000000] ${card.accent}`}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  {card.title}
                </p>
                <h3 className="mt-1 font-mono text-2xl font-black tracking-tight text-zinc-900 dark:text-white">
                  {card.value}
                </h3>
              </div>
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center border ${card.iconBg}`}
              >
                <Icon size={18} />
              </div>
            </div>

            <div className="mt-3 flex items-center gap-1.5 border-t border-zinc-100 dark:border-zinc-800/80 pt-2 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
              <span className="truncate">{card.subtext}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
