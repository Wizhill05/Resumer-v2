"use client"

import React from "react"
import { RefreshCw } from "lucide-react"
import { AdminTabId, ADMIN_TAB_INFO } from "./types"

interface AdminHeaderProps {
  activeTab: AdminTabId
  isFetching?: boolean
  onManualRefresh?: () => void
}

export function AdminHeader({
  activeTab,
  isFetching = false,
  onManualRefresh,
}: AdminHeaderProps) {
  const tabInfo = ADMIN_TAB_INFO[activeTab] || {
    group: "Overview & Operations",
    title: "Admin Dashboard",
    description: "System management and telemetry",
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-4 mb-6">
      <div>
        <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#ff4e26]">
          {tabInfo.group}
        </p>
        <h1 className="text-xl md:text-2xl font-extrabold uppercase tracking-tight text-black dark:text-white">
          {tabInfo.title}
        </h1>
        <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
          {tabInfo.description}
        </p>
      </div>

      {onManualRefresh && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onManualRefresh}
            disabled={isFetching}
            className="flex items-center gap-1.5 border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 hover:border-black dark:hover:border-white hover:text-black dark:hover:text-white transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
            title="Refresh Data"
          >
            <RefreshCw size={13} className={isFetching ? "animate-spin text-[#ff4e26]" : ""} />
            <span>Refresh</span>
          </button>
        </div>
      )}
    </div>
  )
}
