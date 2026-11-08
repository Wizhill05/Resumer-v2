"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { BarChart2, Boxes, Cpu, Database, FileText, LayoutGrid, MessageSquare, Play, Settings, Timer, Users, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { ADMIN_TAB_INFO, type AdminNavItem, type AdminTabId } from "./types"

const NAV_GROUPS: { group: string; items: AdminNavItem[] }[] = [
  {
    group: "Overview & Operations",
    items: [
      { id: "overview", label: "Overview", icon: BarChart2 },
      { id: "generations", label: "Generations", icon: FileText },
      { id: "timing", label: "Pipeline timing", icon: Timer },
      { id: "users", label: "Users & limits", icon: Users },
      { id: "feedback", label: "Support", icon: MessageSquare },
    ],
  },
  {
    group: "AI Engine & Infrastructure",
    items: [
      { id: "models", label: "LLM endpoints", icon: Cpu },
      { id: "prompts", label: "Prompts", icon: Settings },
      { id: "metrics", label: "LLM metrics", icon: Database },
      { id: "templates", label: "Templates", icon: Play },
      { id: "storage", label: "Storage", icon: Boxes },
    ],
  },
]

const PRIMARY_MOBILE: AdminTabId[] = ["overview", "generations", "users", "feedback"]
const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items)
const itemFor = (id: AdminTabId) => ALL_ITEMS.find((item) => item.id === id)!

function Badge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="inline-flex min-w-5 items-center justify-center border border-red-300 bg-red-100 px-1 font-mono text-[10px] font-bold leading-5 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
      {count > 99 ? "99+" : count}
    </span>
  )
}

function MoreSheet({
  activeTab,
  openCount,
  onSelect,
  onClose,
}: {
  activeTab: AdminTabId
  openCount: number
  onSelect: (tab: AdminTabId) => void
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    document.addEventListener("keydown", onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[60] md:hidden" role="dialog" aria-modal="true" aria-label="All admin sections">
      <button type="button" aria-label="Close menu" className="absolute inset-0 cursor-default bg-black/50" onClick={onClose} tabIndex={-1} />
      <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto border-t-2 border-black bg-[#fbfbf3] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] dark:border-zinc-600 dark:bg-zinc-900">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-black uppercase tracking-wide">Admin sections</p>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 cursor-pointer items-center justify-center border border-zinc-300 dark:border-zinc-700">
            <X size={18} />
          </button>
        </div>
        {NAV_GROUPS.map((group) => (
          <div key={group.group} className="mb-4 last:mb-0">
            <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-500">{group.group}</p>
            <div className="grid grid-cols-2 gap-2">
              {group.items.map((item) => {
                const Icon = item.icon
                const active = activeTab === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => onSelect(item.id)}
                    className={cn(
                      "flex min-h-14 cursor-pointer items-center gap-2.5 border px-3 text-left text-sm font-bold",
                      active
                        ? "border-[#ff4e26] bg-[#ff4e26]/10 text-black dark:text-white"
                        : "border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                    )}
                  >
                    <Icon size={18} className={cn("shrink-0", active && "text-[#ff4e26]")} />
                    <span className="min-w-0 flex-1 break-words leading-tight">{item.label}</span>
                    {item.id === "feedback" && <Badge count={openCount} />}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function AdminShell({
  activeTab,
  onSelectTab,
  openReports = 0,
  actions,
  children,
}: {
  activeTab: AdminTabId
  onSelectTab: (tab: AdminTabId) => void
  openReports?: number
  actions?: ReactNode
  children: ReactNode
}) {
  const [moreOpen, setMoreOpen] = useState(false)
  const info = ADMIN_TAB_INFO[activeTab]
  const inMore = !PRIMARY_MOBILE.includes(activeTab)

  const select = (tab: AdminTabId) => {
    setMoreOpen(false)
    onSelectTab(tab)
    window.scrollTo({ top: 0 })
  }

  return (
    <div className="flex w-full flex-1 flex-col md:flex-row">
      {/* Desktop sidebar */}
      <aside className="z-20 hidden shrink-0 overflow-y-auto border-r border-zinc-200 bg-[#fbfbf3] p-3 dark:border-zinc-800 dark:bg-zinc-900 md:fixed md:left-0 md:top-[49px] md:flex md:h-[calc(100dvh-49px)] md:w-56 md:flex-col md:justify-center">
        <nav aria-label="Admin navigation" className="flex flex-col gap-6">
          {NAV_GROUPS.map((group) => (
            <div key={group.group} className="space-y-1">
              <p className="px-2.5 pb-1 font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-500">{group.group}</p>
              {group.items.map((item) => {
                const Icon = item.icon
                const active = activeTab === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => select(item.id)}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2.5 border-l-2 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider transition-colors",
                      active
                        ? "border-[#ff4e26] bg-zinc-200/80 font-black text-[#ff4e26] dark:bg-zinc-800"
                        : "border-transparent text-zinc-600 hover:bg-zinc-200/50 hover:text-black dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-white"
                    )}
                  >
                    <Icon size={16} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate leading-none">{item.label}</span>
                    {item.id === "feedback" && <Badge count={openReports} />}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
      </aside>

      {/* Workspace */}
      <div className="min-w-0 flex-1 bg-[#fbfbf3] dark:bg-zinc-900 md:pl-56">
        <div className="mx-auto w-full max-w-6xl px-3 pb-28 pt-4 sm:px-6 sm:pt-6 md:pb-10">
          <header className="mb-5 flex items-start justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
            <div className="min-w-0">
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#ff4e26]">{info.group}</p>
              <h1 className="break-words text-2xl font-extrabold tracking-tight text-black dark:text-white">{info.title}</h1>
              <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">{info.description}</p>
            </div>
            {actions}
          </header>
          {children}
        </div>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Admin navigation"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t-2 border-black bg-white pb-[env(safe-area-inset-bottom)] dark:border-zinc-600 dark:bg-zinc-950 md:hidden"
      >
        {PRIMARY_MOBILE.map((id) => {
          const item = itemFor(id)
          const Icon = item.icon
          const active = activeTab === id
          return (
            <button
              key={id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => select(id)}
              className={cn(
                "relative flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 text-[11px] font-bold",
                active ? "text-[#ff4e26]" : "text-zinc-600 dark:text-zinc-400"
              )}
            >
              {active && <span aria-hidden="true" className="absolute inset-x-3 top-0 h-0.5 bg-[#ff4e26]" />}
              <Icon size={20} />
              <span>{id === "feedback" ? "Support" : item.label.split(" ")[0]}</span>
              {id === "feedback" && openReports > 0 && (
                <span className="absolute right-[22%] top-1.5 h-2 w-2 rounded-full bg-red-500" aria-label={`${openReports} open`} />
              )}
            </button>
          )
        })}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
          className={cn(
            "relative flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 text-[11px] font-bold",
            inMore ? "text-[#ff4e26]" : "text-zinc-600 dark:text-zinc-400"
          )}
        >
          {inMore && <span aria-hidden="true" className="absolute inset-x-3 top-0 h-0.5 bg-[#ff4e26]" />}
          <LayoutGrid size={20} />
          <span>{inMore ? itemFor(activeTab).label.split(" ")[0] : "More"}</span>
        </button>
      </nav>
      {moreOpen && <MoreSheet activeTab={activeTab} openCount={openReports} onSelect={select} onClose={() => setMoreOpen(false)} />}
    </div>
  )
}
