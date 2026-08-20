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
import { AdminTabId } from "./types"

interface AdminSidebarProps {
  activeTab: AdminTabId
  onSelectTab: (tab: AdminTabId) => void
  isCollapsed: boolean
  onToggleCollapse: () => void
  isMobileOpen: boolean
  onCloseMobile: () => void
  unresolvedReportsCount?: number
  activeGenerationsCount?: number
}

interface NavItem {
  id: AdminTabId
  label: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  badge?: number | string
  badgeVariant?: "default" | "alert" | "neutral"
}

interface NavGroup {
  group: string
  items: NavItem[]
}

export function AdminSidebar({
  activeTab,
  onSelectTab,
  isCollapsed,
  onToggleCollapse,
  isMobileOpen,
  onCloseMobile,
  unresolvedReportsCount = 0,
  activeGenerationsCount = 0,
}: AdminSidebarProps) {
  const navGroups: NavGroup[] = [
    {
      group: "Command Center",
      items: [
        { id: "analytics", label: "Overview & Health", icon: BarChart2 },
        {
          id: "generations",
          label: "Live Generations",
          icon: FileText,
          badge: activeGenerationsCount > 0 ? activeGenerationsCount : undefined,
          badgeVariant: "default",
        },
      ],
    },
    {
      group: "AI Engine & Core",
      items: [
        { id: "models", label: "Model Providers", icon: Cpu },
        { id: "timing", label: "Pipeline Timing", icon: Timer },
        { id: "prompts", label: "Prompt Manager", icon: Settings },
        { id: "metrics", label: "LLM Node Metrics", icon: Database },
      ],
    },
    {
      group: "Operations & Users",
      items: [
        { id: "users", label: "User Rate Limits", icon: Users },
        {
          id: "feedback",
          label: "Feedback & Support",
          icon: MessageSquare,
          badge: unresolvedReportsCount > 0 ? unresolvedReportsCount : undefined,
          badgeVariant: "alert",
        },
      ],
    },
    {
      group: "System & Assets",
      items: [
        { id: "templates", label: "Template Sandbox", icon: Play },
        { id: "storage", label: "Storage Explorer", icon: Boxes },
      ],
    },
  ]

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between overflow-y-auto bg-zinc-950 text-white select-none">
      {/* Top Brand Section */}
      <div>
        <div className="flex h-16 items-center justify-between border-b border-zinc-800 px-4">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-zinc-700 bg-zinc-900 text-[#ff4e26] font-mono font-bold shadow-[2px_2px_0px_#000000]">
              <Sparkles size={18} />
            </div>
            {!isCollapsed && (
              <div className="flex flex-col overflow-hidden">
                <span className="font-mono text-xs font-black tracking-wider text-[#ff4e26]">
                  RESUMER // V2
                </span>
                <span className="text-sm font-extrabold uppercase tracking-tight text-white">
                  Admin Console
                </span>
              </div>
            )}
          </div>

          {/* Desktop collapse toggle */}
          <button
            type="button"
            onClick={onToggleCollapse}
            className="hidden md:flex h-7 w-7 items-center justify-center border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-white transition-colors"
            title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          >
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>

          {/* Mobile close button */}
          <button
            type="button"
            onClick={onCloseMobile}
            className="flex md:hidden h-7 w-7 items-center justify-center border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>

        {/* User / Operator Mini Card */}
        <div className={`border-b border-zinc-800 bg-zinc-900/60 p-3 transition-all ${isCollapsed ? "text-center px-2" : "px-4"}`}>
          <div className="flex items-center gap-3">
            <div className="relative flex h-8 w-8 shrink-0 items-center justify-center border border-zinc-700 bg-zinc-800 font-mono text-xs font-bold text-zinc-200">
              AD
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-zinc-950" />
            </div>
            {!isCollapsed && (
              <div className="flex flex-col min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="truncate text-xs font-bold text-white">System Operator</span>
                  <span className="border border-emerald-500/40 bg-emerald-950/60 px-1.5 py-0.2 font-mono text-[9px] font-bold text-emerald-400 uppercase">
                    Admin
                  </span>
                </div>
                <span className="truncate text-[11px] text-zinc-400">admin@resumer.ai</span>
              </div>
            )}
          </div>
        </div>

        {/* Navigation List */}
        <nav className="space-y-5 px-3 py-4">
          {navGroups.map((group) => (
            <div key={group.group} className="space-y-1">
              {!isCollapsed && (
                <p className="px-2 pb-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  {group.group}
                </p>
              )}
              {group.items.map((item) => {
                const Icon = item.icon
                const isActive = activeTab === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onSelectTab(item.id)
                      onCloseMobile()
                    }}
                    title={isCollapsed ? item.label : undefined}
                    className={`group relative flex w-full items-center gap-3 px-3 py-2 text-xs font-bold uppercase tracking-wider transition-all ${
                      isActive
                        ? "bg-[#ff4e26] text-white border-l-4 border-white shadow-[2px_2px_0px_#000000]"
                        : "text-zinc-400 hover:bg-zinc-900 hover:text-white border-l-4 border-transparent"
                    } ${isCollapsed ? "justify-center px-2" : ""}`}
                  >
                    <Icon
                      size={16}
                      className={isActive ? "text-white" : "text-zinc-400 group-hover:text-white"}
                    />
                    {!isCollapsed && <span className="truncate">{item.label}</span>}

                    {/* Badge */}
                    {!isCollapsed && item.badge !== undefined && (
                      <span
                        className={`ml-auto border px-1.5 py-0.5 font-mono text-[10px] font-extrabold ${
                          isActive
                            ? "border-white bg-black/40 text-white"
                            : item.badgeVariant === "alert"
                            ? "border-red-600 bg-red-950 text-red-300"
                            : "border-zinc-700 bg-zinc-800 text-zinc-300"
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}

                    {isCollapsed && item.badge !== undefined && (
                      <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-[#ff4e26]" />
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
      </div>

      {/* Footer System Info & Quick Links */}
      <div className="border-t border-zinc-800 bg-zinc-900/80 p-3">
        {!isCollapsed ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Backend Node
              </span>
              <span className="text-zinc-200">ONLINE</span>
            </div>
            <Link
              href="/"
              className="flex w-full items-center justify-between border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs font-bold uppercase tracking-wider text-zinc-300 hover:border-[#ff4e26] hover:text-white transition-colors"
            >
              <span>Back to App</span>
              <ArrowUpRight size={14} />
            </Link>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Link
              href="/"
              title="Back to App"
              className="flex h-8 w-8 items-center justify-center border border-zinc-700 bg-zinc-950 text-zinc-300 hover:border-[#ff4e26] hover:text-white"
            >
              <ArrowUpRight size={14} />
            </Link>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={`hidden md:block shrink-0 border-r border-zinc-800 transition-all duration-200 ${
          isCollapsed ? "w-20" : "w-64"
        }`}
      >
        <div className="sticky top-0 h-screen">{sidebarContent}</div>
      </aside>

      {/* Mobile Drawer Backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm md:hidden"
          onClick={onCloseMobile}
        />
      )}

      {/* Mobile Drawer Container */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 transform border-r border-zinc-800 bg-zinc-950 transition-transform duration-200 md:hidden ${
          isMobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebarContent}
      </aside>
    </>
  )
}
