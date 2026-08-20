"use client"

import React from "react"
import { Menu, RefreshCw } from "lucide-react"
import { AdminTabId, ADMIN_TAB_INFO } from "./types"

interface AdminHeaderProps {
  activeTab: AdminTabId
  onToggleMobileSidebar: () => void
  isFetching: boolean
  onManualRefresh: () => void
  pollingInterval: number | false
  onPollingChange: (interval: number | false) => void
}

export function AdminHeader({
  activeTab,
  onToggleMobileSidebar,
  isFetching,
  onManualRefresh,
  pollingInterval,
  onPollingChange,
}: AdminHeaderProps) {
  const tabInfo = ADMIN_TAB_INFO[activeTab] || {
    group: "Overview & Operations",
    title: "Admin Dashboard",
    description: "System management and telemetry",
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 w-full items-center justify-between border-b border-zinc-800 bg-zinc-950/95 px-4 backdrop-blur-xs md:px-6">
      {/* Left: Mobile Toggle & Page Title */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onToggleMobileSidebar}
          className="flex h-8 w-8 items-center justify-center border border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-white md:hidden cursor-pointer"
          title="Open Navigation"
        >
          <Menu size={16} />
        </button>

        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-[#ff4e26]">
              {tabInfo.group}
            </span>
          </div>
          <h1 className="text-sm font-extrabold uppercase tracking-tight text-white truncate">
            {tabInfo.title}
          </h1>
        </div>
      </div>

      {/* Right: Controls (Polling Selector + Refresh Button) */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Polling Interval Selector */}
        <div className="flex items-center border border-zinc-800 bg-zinc-900 p-0.5 text-[10px] font-mono">
          <span className="px-1.5 text-zinc-500 hidden sm:inline uppercase">Poll:</span>
          {[
            { label: "Off", val: false as const },
            { label: "15s", val: 15000 },
            { label: "30s", val: 30000 },
          ].map((opt) => (
            <button
              key={String(opt.val)}
              type="button"
              onClick={() => onPollingChange(opt.val)}
              className={`px-1.5 py-0.5 font-bold uppercase transition-colors cursor-pointer ${
                pollingInterval === opt.val
                  ? "bg-[#ff4e26] text-white"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Manual Refresh Button */}
        <button
          type="button"
          onClick={onManualRefresh}
          disabled={isFetching}
          className="flex h-7 w-7 items-center justify-center border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700 hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
          title="Refresh Data"
        >
          <RefreshCw size={13} className={isFetching ? "animate-spin text-[#ff4e26]" : ""} />
        </button>
      </div>
    </header>
  )
}
