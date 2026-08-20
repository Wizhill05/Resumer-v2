"use client"

import React from "react"
import {
  Menu,
  Search,
  RefreshCw,
  Cpu,
  Bell,
  X,
} from "lucide-react"
import { AdminTabId, ModelTierConfig } from "./types"

interface AdminHeaderProps {
  activeTab: AdminTabId
  onToggleMobileSidebar: () => void
  searchQuery: string
  onSearchChange: (val: string) => void
  isFetching: boolean
  onManualRefresh: () => void
  pollingInterval: number | false
  onPollingChange: (interval: number | false) => void
  activeProModel?: ModelTierConfig
  unresolvedReportsCount?: number
  onNavigateToFeedback?: () => void
}

const TAB_TITLES: Record<AdminTabId, { category: string; title: string }> = {
  analytics: { category: "Command Center", title: "Overview & Analytics" },
  generations: { category: "Command Center", title: "Live Generations & Traces" },
  models: { category: "AI Engine & Core", title: "Model Providers & Routing" },
  timing: { category: "AI Engine & Core", title: "Pipeline Timing & Benchmarks" },
  prompts: { category: "AI Engine & Core", title: "Prompt Manager & Testing" },
  metrics: { category: "AI Engine & Core", title: "LLM Node Metrics" },
  users: { category: "Operations & Users", title: "User Rate Limits & Caps" },
  feedback: { category: "Operations & Users", title: "Feedback & Support Triage" },
  templates: { category: "System & Assets", title: "Template Sandbox" },
  storage: { category: "System & Assets", title: "Storage Explorer (R2)" },
}

export function AdminHeader({
  activeTab,
  onToggleMobileSidebar,
  searchQuery,
  onSearchChange,
  isFetching,
  onManualRefresh,
  pollingInterval,
  onPollingChange,
  activeProModel,
  unresolvedReportsCount = 0,
  onNavigateToFeedback,
}: AdminHeaderProps) {
  const currentTabInfo = TAB_TITLES[activeTab] || { category: "Console", title: "Admin" }

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 px-4 backdrop-blur md:px-6">
      {/* Left: Mobile Toggle & Page Title */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleMobileSidebar}
          className="flex h-9 w-9 items-center justify-center border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:text-black dark:hover:text-white md:hidden"
          title="Open Menu"
        >
          <Menu size={18} />
        </button>

        <div className="flex flex-col">
          <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#ff4e26]">
            {currentTabInfo.category}
          </span>
          <h1 className="text-sm md:text-base font-extrabold uppercase tracking-tight text-zinc-900 dark:text-white">
            {currentTabInfo.title}
          </h1>
        </div>
      </div>

      {/* Middle: Global Quick Search Input */}
      <div className="hidden lg:flex flex-1 max-w-md mx-6">
        <div className="relative w-full">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search across generations, users, models..."
            className="h-9 w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 pl-9 pr-8 text-xs font-mono text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:border-[#ff4e26] focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Right: Status Pills & Controls */}
      <div className="flex items-center gap-2 md:gap-3">
        {/* Active Model Pill */}
        <div className="hidden sm:flex items-center gap-2 border border-zinc-200 dark:border-zinc-800 bg-zinc-100/80 dark:bg-zinc-900/80 px-2.5 py-1 text-xs font-mono">
          <Cpu size={13} className="text-[#ff4e26]" />
          <span className="text-zinc-500 dark:text-zinc-400 text-[11px]">PRO:</span>
          <span className="truncate max-w-[130px] font-bold text-zinc-800 dark:text-zinc-200 text-[11px]" title={activeProModel?.model || "antigravity/gemini-3.7-flash-tiered"}>
            {activeProModel?.model ? activeProModel.model.split("/").pop() : "Gemini 3.7"}
          </span>
        </div>

        {/* Polling Interval Selector */}
        <div className="flex items-center border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900 p-0.5 text-[11px] font-mono">
          <span className="px-2 text-zinc-500 hidden xl:inline">Poll:</span>
          {[
            { label: "Off", val: false as const },
            { label: "15s", val: 15000 },
            { label: "30s", val: 30000 },
          ].map((opt) => (
            <button
              key={String(opt.val)}
              type="button"
              onClick={() => onPollingChange(opt.val)}
              className={`px-2 py-0.5 font-bold uppercase transition-colors ${
                pollingInterval === opt.val
                  ? "bg-[#ff4e26] text-white"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Feedback Alert Button */}
        {unresolvedReportsCount > 0 && onNavigateToFeedback && (
          <button
            type="button"
            onClick={onNavigateToFeedback}
            className="relative flex h-8 items-center gap-1.5 border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/60 px-2.5 text-xs font-mono font-bold text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/60 transition-colors"
            title={`${unresolvedReportsCount} pending support reports`}
          >
            <Bell size={13} className="animate-bounce text-red-500" />
            <span>{unresolvedReportsCount}</span>
          </button>
        )}

        {/* Refresh Button */}
        <button
          type="button"
          onClick={onManualRefresh}
          disabled={isFetching}
          className="flex h-8 w-8 items-center justify-center border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:border-black dark:hover:border-white hover:text-black dark:hover:text-white transition-colors disabled:opacity-50"
          title="Manual Refresh"
        >
          <RefreshCw size={14} className={isFetching ? "animate-spin text-[#ff4e26]" : ""} />
        </button>
      </div>
    </header>
  )
}
