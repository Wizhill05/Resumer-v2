"use client"

import React, { useRef, useState } from "react"
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
  ChevronDown
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
      { id: "feedback", label: "Support & Feedback", icon: MessageSquare }
    ]
  },
  {
    group: "AI Engine & Infrastructure",
    items: [
      { id: "models", label: "Model Providers", icon: Cpu },
      { id: "prompts", label: "Prompt Manager", icon: Settings },
      { id: "metrics", label: "LLM Metrics", icon: Database },
      { id: "templates", label: "Templates", icon: Play },
      { id: "storage", label: "Storage", icon: Boxes }
    ]
  }
]

export function AdminSidebar({
  activeTab,
  onSelectTab,
  unresolvedReportsCount = 0
}: AdminSidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const mobileToggle = useRef<HTMLButtonElement>(null)
  const currentItem = NAV_GROUPS.flatMap((group) => group.items).find(
    (item) => item.id === activeTab
  )
  return (
    <aside className="w-full min-w-0 md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-zinc-200 dark:border-zinc-800 bg-[#fbfbf3] dark:bg-zinc-900 p-3 select-none flex flex-col md:justify-center md:fixed md:left-0 md:top-[49px] md:h-[calc(100dvh-49px)] md:max-h-[calc(100dvh-49px)] md:overflow-y-auto z-20">
      <div
        className="md:hidden"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setMobileOpen(false)
            mobileToggle.current?.focus()
          }
        }}
      >
        <button
          ref={mobileToggle}
          type="button"
          aria-expanded={mobileOpen}
          aria-controls="mobile-admin-navigation"
          onClick={() => setMobileOpen((value) => !value)}
          className="flex min-h-12 w-full items-center gap-3 border border-zinc-300 bg-white px-3 text-left text-sm font-bold focus-visible:outline-2 focus-visible:outline-[#ff4e26] dark:border-zinc-700 dark:bg-zinc-900"
        >
          <span className="text-zinc-500">Admin</span>
          <span className="min-w-0 flex-1 break-words">{currentItem?.label}</span>
          <ChevronDown
            size={18}
            aria-hidden="true"
            className={`shrink-0 transition-transform ${mobileOpen ? "rotate-180" : ""}`}
          />
        </button>
        <nav
          id="mobile-admin-navigation"
          aria-label="Admin sections"
          hidden={!mobileOpen}
          className="border border-t-0 border-zinc-300 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900"
        >
          {NAV_GROUPS.map((group) => (
            <div key={group.group} className="mb-4 last:mb-0">
              <p className="mb-2 text-xs text-zinc-500">{group.group}</p>
              <div className="grid grid-cols-2 gap-2">
                {group.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={activeTab === item.id ? "page" : undefined}
                      onClick={() => {
                        onSelectTab(item.id)
                        setMobileOpen(false)
                        mobileToggle.current?.focus()
                      }}
                      className={`flex min-h-12 items-center gap-2 border px-3 py-2 text-left text-xs font-bold focus-visible:outline-2 focus-visible:outline-[#ff4e26] ${activeTab === item.id ? "border-[#ff4e26] bg-[#ff4e26]/10 text-black dark:text-white" : "border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"}`}
                    >
                      <Icon size={16} className="shrink-0" />
                      <span className="min-w-0 break-words">{item.label}</span>
                      {item.id === "feedback" && unresolvedReportsCount > 0 && (
                        <span className="ml-auto text-[#ff4e26]">{unresolvedReportsCount}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>
      {/* Grouped Navigation */}
      <nav aria-label="Admin navigation" className="hidden md:flex md:flex-col gap-6 my-0">
        {NAV_GROUPS.map((group) => (
          <div key={group.group} className="space-y-1 shrink-0 md:shrink">
            <p className="hidden md:block px-2.5 pb-1 font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-500">
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
                    className={`flex items-center gap-2.5 px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap rounded-none w-full text-left ${
                      isActive
                        ? "bg-zinc-200/80 dark:bg-zinc-800 text-[#ff4e26] border-l-2 border-[#ff4e26] shadow-xs font-black"
                        : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 hover:text-black dark:hover:text-white border-l-2 border-transparent font-bold"
                    }`}
                  >
                    <Icon
                      size={16}
                      className={`shrink-0 ${
                        isActive ? "text-[#ff4e26]" : "text-zinc-500 dark:text-zinc-400"
                      }`}
                    />
                    <span className="truncate leading-none">{item.label}</span>

                    {/* Unresolved reports notification badge */}
                    {isFeedbackWithReports && (
                      <span className="ml-auto inline-flex items-center justify-center border border-red-300 dark:border-red-800 bg-red-100 dark:bg-red-950 px-1.5 py-0.5 font-mono text-[10px] font-bold text-red-700 dark:text-red-300 leading-none">
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
