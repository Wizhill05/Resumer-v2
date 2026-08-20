"use client"

import React from "react"
import {
  BarChart2,
  Cpu,
  FileText,
  Timer,
  Settings,
  Users,
  Database,
  Boxes,
  Play,
  MessageSquare,
} from "lucide-react"
import { AdminTabId, AdminNavGroup } from "./types"

interface AdminSidebarProps {
  activeTab: AdminTabId
  onSelectTab: (tab: AdminTabId) => void
  unresolvedReportsCount?: number
}

const NAV_GROUPS: AdminNavGroup[] = [
  {
    group: "Overview & Operations",
    items: [
      { id: "analytics", label: "Analytics", icon: BarChart2 },
      { id: "generations", label: "Generations", icon: FileText },
      { id: "timing", label: "Pipeline Timing", icon: Timer },
      { id: "users", label: "User Limits", icon: Users },
      { id: "feedback", label: "Support & Feedback", icon: MessageSquare },
    ],
  },
  {
    group: "AI Engine & Infrastructure",
    items: [
      { id: "models", label: "Model Providers", icon: Cpu },
      { id: "prompts", label: "Prompt Manager", icon: Settings },
      { id: "metrics", label: "LLM Metrics", icon: Database },
      { id: "templates", label: "Templates", icon: Play },
      { id: "storage", label: "Storage", icon: Boxes },
    ],
  },
]

export function AdminSidebar({
  activeTab,
  onSelectTab,
  unresolvedReportsCount = 0,
}: AdminSidebarProps) {
  return (
    <aside className="w-full md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3 select-none">
      {/* Grouped Navigation */}
      <nav className="flex flex-row md:flex-col gap-4 overflow-x-auto md:overflow-x-visible pb-2 md:pb-0">
        {NAV_GROUPS.map((group) => (
          <div key={group.group} className="space-y-1 shrink-0 md:shrink">
            <p className="hidden md:block px-2 pb-1 font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              {group.group}
            </p>
            <div className="flex flex-row md:flex-col gap-1">
              {group.items.map((item) => {
                const Icon = item.icon
                const isActive = activeTab === item.id
                const isFeedbackWithReports = item.id === "feedback" && unresolvedReportsCount > 0

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectTab(item.id)}
                    className={`flex items-center gap-2.5 px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap rounded-none ${
                      isActive
                        ? "bg-zinc-100 dark:bg-zinc-800 text-[#ff4e26] border-l-2 border-[#ff4e26] shadow-xs"
                        : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900 hover:text-black dark:hover:text-white border-l-2 border-transparent"
                    }`}
                  >
                    <Icon
                      size={15}
                      className={isActive ? "text-[#ff4e26]" : "text-zinc-500 dark:text-zinc-400"}
                    />
                    <span>{item.label}</span>

                    {/* Unresolved reports notification badge */}
                    {isFeedbackWithReports && (
                      <span className="ml-auto border border-red-300 dark:border-red-800 bg-red-100 dark:bg-red-950 px-1.5 py-0.2 font-mono text-[10px] font-bold text-red-700 dark:text-red-300">
                        {unresolvedReportsCount}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  )
}
