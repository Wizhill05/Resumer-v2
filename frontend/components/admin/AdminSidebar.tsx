"use client"

import React from "react"
import Link from "next/link"
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
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  Sparkles,
  X,
} from "lucide-react"
import { AdminTabId, AdminNavGroup } from "./types"

interface AdminSidebarProps {
  activeTab: AdminTabId
  onSelectTab: (tab: AdminTabId) => void
  isCollapsed: boolean
  onToggleCollapse: () => void
  isMobileOpen: boolean
  onCloseMobile: () => void
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
  isCollapsed,
  onToggleCollapse,
  isMobileOpen,
  onCloseMobile,
  unresolvedReportsCount = 0,
}: AdminSidebarProps) {
  const renderSidebarContent = (isMobile = false) => {
    const collapsed = isMobile ? false : isCollapsed

    return (
      <div className="flex h-full flex-col justify-between overflow-y-auto bg-zinc-950 text-white select-none">
        {/* Top Branding Section */}
        <div>
          <div className="flex h-14 items-center justify-between border-b border-zinc-800 px-4">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center border border-zinc-700 bg-zinc-900 text-[#ff4e26] font-mono font-bold shadow-[2px_2px_0px_#000000]">
                <Sparkles size={14} />
              </div>
              {!collapsed && (
                <div className="flex items-center gap-1.5 overflow-hidden">
                  <span className="font-mono text-xs font-black tracking-wider text-white">
                    RESUMER
                  </span>
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#ff4e26]">
                    // ADMIN
                  </span>
                </div>
              )}
            </div>

            {/* Desktop collapse toggle */}
            {!isMobile && (
              <button
                type="button"
                onClick={onToggleCollapse}
                className="hidden md:flex h-6 w-6 items-center justify-center border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-white transition-colors cursor-pointer"
                title={collapsed ? "Expand Sidebar" : "Collapse Sidebar"}
              >
                {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
              </button>
            )}

            {/* Mobile close button */}
            {isMobile && (
              <button
                type="button"
                onClick={onCloseMobile}
                className="flex md:hidden h-7 w-7 items-center justify-center border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white cursor-pointer"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Grouped Navigation Items */}
          <nav className="space-y-4 px-2.5 py-3.5">
            {NAV_GROUPS.map((group) => (
              <div key={group.group} className="space-y-0.5">
                {!collapsed && (
                  <p className="px-2 pb-1 font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                    {group.group}
                  </p>
                )}
                {group.items.map((item) => {
                  const Icon = item.icon
                  const isActive = activeTab === item.id
                  const isFeedbackWithReports = item.id === "feedback" && unresolvedReportsCount > 0

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onSelectTab(item.id)
                        if (isMobile) onCloseMobile()
                      }}
                      title={collapsed ? item.label : undefined}
                      className={`group relative flex w-full items-center gap-2.5 px-2.5 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                        isActive
                          ? "bg-zinc-800 text-[#ff4e26] border-l-2 border-[#ff4e26]"
                          : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 border-l-2 border-transparent"
                      } ${collapsed ? "justify-center px-1.5" : ""}`}
                    >
                      <Icon
                        size={15}
                        className={isActive ? "text-[#ff4e26]" : "text-zinc-400 group-hover:text-zinc-200"}
                      />
                      {!collapsed && <span className="truncate">{item.label}</span>}

                      {/* Unresolved reports notification badge */}
                      {!collapsed && isFeedbackWithReports && (
                        <span className="ml-auto border border-red-800 bg-red-950 px-1.5 py-0.2 font-mono text-[10px] font-bold text-red-300">
                          {unresolvedReportsCount}
                        </span>
                      )}

                      {collapsed && isFeedbackWithReports && (
                        <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-red-500" />
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </nav>
        </div>

        {/* Bottom Section: Quick Link back to App */}
        <div className="border-t border-zinc-800 bg-zinc-950 p-2.5">
          {!collapsed ? (
            <Link
              href="/"
              className="flex w-full items-center justify-between border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400 hover:border-zinc-700 hover:text-white transition-colors"
            >
              <span>Back to App</span>
              <ArrowUpRight size={13} />
            </Link>
          ) : (
            <Link
              href="/"
              title="Back to App"
              className="flex h-8 w-full items-center justify-center border border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-white"
            >
              <ArrowUpRight size={13} />
            </Link>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Desktop Sidebar Rail */}
      <aside
        className={`hidden md:block shrink-0 border-r border-zinc-800 transition-all duration-150 ${
          isCollapsed ? "w-16" : "w-56"
        }`}
      >
        <div className="sticky top-0 h-screen">{renderSidebarContent(false)}</div>
      </aside>

      {/* Mobile Backdrop & Drawer */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/80 backdrop-blur-xs md:hidden"
          onClick={onCloseMobile}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 transform border-r border-zinc-800 bg-zinc-950 transition-transform duration-200 md:hidden ${
          isMobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {renderSidebarContent(true)}
      </aside>
    </>
  )
}
