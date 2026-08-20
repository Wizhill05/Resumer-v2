"use client"

import React, { useState } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AdminSidebar } from "@/components/admin/AdminSidebar"
import { AdminHeader } from "@/components/admin/AdminHeader"
import { GenerationTraceDrawer } from "@/components/admin/GenerationTraceDrawer"
import { AdminOverviewTab } from "@/components/admin/tabs/AdminOverviewTab"
import { AdminGenerationsTab } from "@/components/admin/tabs/AdminGenerationsTab"
import { AdminTimingTab } from "@/components/admin/tabs/AdminTimingTab"
import { AdminPromptsTab } from "@/components/admin/tabs/AdminPromptsTab"
import { AdminModelsTab } from "@/components/admin/tabs/AdminModelsTab"
import { AdminUsersTab } from "@/components/admin/tabs/AdminUsersTab"
import { AdminMetricsTab } from "@/components/admin/tabs/AdminMetricsTab"
import { AdminStorageTab } from "@/components/admin/tabs/AdminStorageTab"
import { AdminTemplatesTab } from "@/components/admin/tabs/AdminTemplatesTab"
import { AdminFeedbackTab } from "@/components/admin/tabs/AdminFeedbackTab"
import {
  AdminTabId,
  AnalyticsData,
  GenerationItem,
  SupportReportItem,
  ModelSettingsResponse,
} from "@/components/admin/types"

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`)
  return res.json()
}

export function AdminClient() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()

  // 1. URL State Synchronization
  const tabFromUrl = searchParams.get("tab") as AdminTabId | null
  const [activeTab, setActiveTab] = useState<AdminTabId>(tabFromUrl || "analytics")
  const [globalSearch, setGlobalSearch] = useState<string>("")
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false)
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false)
  const [pollingInterval, setPollingInterval] = useState<number | false>(false)

  // 2. Generation Trace Drawer State
  const [selectedTraceGen, setSelectedTraceGen] = useState<GenerationItem | null>(null)
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(searchParams.get("trace") || null)

  // Sync activeTab to URL search params
  const handleSelectTab = (tab: AdminTabId) => {
    setActiveTab(tab)
    const params = new URLSearchParams(searchParams.toString())
    if (tab === "analytics") {
      params.delete("tab")
    } else {
      params.set("tab", tab)
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  // Open Trace Drawer
  const handleInspectGeneration = (gen: GenerationItem) => {
    setSelectedTraceGen(gen)
    setSelectedTraceId(gen.id)
    const params = new URLSearchParams(searchParams.toString())
    params.set("trace", gen.id)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const handleInspectGenerationById = (id: string) => {
    setSelectedTraceId(id)
    const params = new URLSearchParams(searchParams.toString())
    params.set("trace", id)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const handleCloseTraceDrawer = () => {
    setSelectedTraceId(null)
    setSelectedTraceGen(null)
    const params = new URLSearchParams(searchParams.toString())
    params.delete("trace")
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  // 3. Core Data Queries
  // Analytics
  const { data: analytics, isLoading: loadingAnalytics, isFetching: fetchingAnalytics, refetch: refetchAnalytics } = useQuery<AnalyticsData>({
    queryKey: ["admin-analytics"],
    queryFn: () => fetchJson<AnalyticsData>("/api/backend/admin/analytics"),
    refetchInterval: pollingInterval,
  })

  // Recent Generations
  const { data: recentGenerations = [], isLoading: loadingGenerations, isFetching: fetchingGenerations, refetch: refetchGenerations } = useQuery<GenerationItem[]>({
    queryKey: ["admin-recent-generations"],
    queryFn: () => fetchJson<GenerationItem[]>("/api/backend/admin/generations?limit=10"),
    refetchInterval: pollingInterval,
  })

  // Recent Support Reports
  const { data: recentReports = [], isLoading: loadingReports, isFetching: fetchingReports, refetch: refetchReports } = useQuery<SupportReportItem[]>({
    queryKey: ["admin-recent-reports"],
    queryFn: () => fetchJson<SupportReportItem[]>("/api/backend/admin/feedback/reports?limit=5&status=open"),
    refetchInterval: pollingInterval,
  })

  // Model Settings (for Header pill)
  const { data: modelSettings } = useQuery<ModelSettingsResponse>({
    queryKey: ["admin-model-settings"],
    queryFn: () => fetchJson<ModelSettingsResponse>("/api/backend/admin/model-settings"),
  })

  const handleManualRefresh = () => {
    refetchAnalytics()
    refetchGenerations()
    refetchReports()
    queryClient.invalidateQueries()
  }

  const isGlobalFetching = fetchingAnalytics || fetchingGenerations || fetchingReports

  // Active in-flight generation count for sidebar badge
  const activeGenerationsCount = recentGenerations.filter(
    (g) => g.status === "generating" || g.status === "pending"
  ).length

  return (
    <div className="flex min-h-screen bg-[#fbfbf3] dark:bg-zinc-900 text-zinc-900 dark:text-white">
      {/* ── PERSISTENT LEFT SIDEBAR ── */}
      <AdminSidebar
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
        isMobileOpen={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        unresolvedReportsCount={recentReports.length}
        activeGenerationsCount={activeGenerationsCount}
      />

      {/* ── MAIN CONTENT WORKSPACE ── */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Top Header Bar */}
        <AdminHeader
          activeTab={activeTab}
          onToggleMobileSidebar={() => setIsMobileSidebarOpen(true)}
          searchQuery={globalSearch}
          onSearchChange={setGlobalSearch}
          isFetching={isGlobalFetching}
          onManualRefresh={handleManualRefresh}
          pollingInterval={pollingInterval}
          onPollingChange={setPollingInterval}
          activeProModel={modelSettings?.pro}
          unresolvedReportsCount={recentReports.length}
          onNavigateToFeedback={() => handleSelectTab("feedback")}
        />

        {/* Tab Canvas Surface */}
        <main className="flex-1 p-4 md:p-6 max-w-7xl w-full mx-auto">
          {activeTab === "analytics" && (
            <AdminOverviewTab
              analytics={analytics}
              loadingAnalytics={loadingAnalytics}
              recentGenerations={recentGenerations}
              loadingGenerations={loadingGenerations}
              recentReports={recentReports}
              loadingReports={loadingReports}
              onNavigateTab={handleSelectTab}
              onInspectGeneration={handleInspectGeneration}
            />
          )}

          {activeTab === "generations" && (
            <AdminGenerationsTab
              onInspectGeneration={handleInspectGeneration}
              initialSearch={globalSearch}
            />
          )}

          {activeTab === "models" && <AdminModelsTab />}

          {activeTab === "timing" && (
            <AdminTimingTab onInspectGenerationById={handleInspectGenerationById} />
          )}

          {activeTab === "prompts" && <AdminPromptsTab />}

          {activeTab === "metrics" && <AdminMetricsTab />}

          {activeTab === "users" && <AdminUsersTab />}

          {activeTab === "storage" && <AdminStorageTab />}

          {activeTab === "templates" && <AdminTemplatesTab />}

          {activeTab === "feedback" && (
            <AdminFeedbackTab onInspectGenerationById={handleInspectGenerationById} />
          )}
        </main>
      </div>

      {/* ── SLIDE-OVER GENERATION TRACE DRAWER ── */}
      <GenerationTraceDrawer
        generationId={selectedTraceId}
        isOpen={!!selectedTraceId}
        onClose={handleCloseTraceDrawer}
        generationMeta={selectedTraceGen || recentGenerations.find((g) => g.id === selectedTraceId)}
      />
    </div>
  )
}
