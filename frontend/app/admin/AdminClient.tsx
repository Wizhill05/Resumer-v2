"use client"

import { useCallback, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Lock } from "lucide-react"
import { AdminShell } from "@/components/admin/AdminShell"
import { LlmSettingsPanel } from "@/components/admin/llm/LlmSettingsPanel"
import { OverviewTab } from "@/components/admin/overview/OverviewTab"
import { GenerationsTab, TimingWaterfallModal } from "@/components/admin/tabs/GenerationsTab"
import { FeedbackTab } from "@/components/admin/tabs/FeedbackTab"
import { MetricsTab } from "@/components/admin/tabs/MetricsTab"
import { PromptsTab } from "@/components/admin/tabs/PromptsTab"
import { StorageTab } from "@/components/admin/tabs/StorageTab"
import { TemplatesTab } from "@/components/admin/tabs/TemplatesTab"
import { TimingTab } from "@/components/admin/tabs/TimingTab"
import { UsersTab } from "@/components/admin/tabs/UsersTab"
import type { AnalyticsData, FeedbackAnalytics, GenerationItem } from "@/components/admin/api-types"
import { fetchJson } from "@/components/admin/shared"
import type { AdminTabId } from "@/components/admin/types"

export function AdminClient({ initialTab = "overview" }: { initialTab?: AdminTabId }) {
  const [activeTab, setActiveTab] = useState<AdminTabId>(initialTab)
  const [waterfall, setWaterfall] = useState<GenerationItem | null>(null)
  const [logsRequest, setLogsRequest] = useState<{ id: string; nonce: number } | null>(null)

  // Doubles as the access check: non-admins get a 403 here.
  const { error: accessError } = useQuery<AnalyticsData>({
    queryKey: ["admin", "analytics"],
    queryFn: () => fetchJson<AnalyticsData>("/api/backend/admin/analytics"),
  })
  const { data: feedback } = useQuery<FeedbackAnalytics>({
    queryKey: ["admin", "feedback", "analytics"],
    queryFn: () => fetchJson<FeedbackAnalytics>("/api/backend/admin/feedback/analytics"),
    staleTime: 30000,
  })

  const selectTab = useCallback((tab: AdminTabId) => {
    setActiveTab(tab)
    const url = new URL(window.location.href)
    if (tab === "overview") url.searchParams.delete("tab")
    else url.searchParams.set("tab", tab)
    window.history.replaceState(null, "", url)
  }, [])

  const openLogs = useCallback(
    (id: string) => {
      setLogsRequest({ id, nonce: Date.now() })
      selectTab("generations")
    },
    [selectTab]
  )

  if (accessError?.message === "Access Denied" || accessError?.message === "Unauthorized") {
    return (
      <div className="pixel-enter mx-auto mt-12 max-w-md border border-zinc-200 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
        <Lock className="mx-auto mb-4 text-red-500" size={48} />
        <h2 className="text-xl font-bold uppercase text-red-600">Access denied</h2>
        <p className="mt-2 text-sm font-semibold text-zinc-600 dark:text-zinc-400">Your account does not have admin permissions to access this control panel.</p>
      </div>
    )
  }

  return (
    <AdminShell activeTab={activeTab} onSelectTab={selectTab} openReports={feedback?.open_count ?? 0}>
      {activeTab === "overview" && <OverviewTab onOpenTab={selectTab} />}
      {activeTab === "generations" && <GenerationsTab key={logsRequest?.nonce ?? "list"} initialLogsId={logsRequest?.id} onWaterfall={setWaterfall} />}
      {activeTab === "timing" && <TimingTab onWaterfall={setWaterfall} onLogs={openLogs} />}
      {activeTab === "users" && <UsersTab />}
      {activeTab === "feedback" && <FeedbackTab />}
      {activeTab === "models" && <LlmSettingsPanel />}
      {activeTab === "prompts" && <PromptsTab />}
      {activeTab === "metrics" && <MetricsTab />}
      {activeTab === "templates" && <TemplatesTab />}
      {activeTab === "storage" && <StorageTab />}
      {waterfall && <TimingWaterfallModal generation={waterfall} onClose={() => setWaterfall(null)} />}
    </AdminShell>
  )
}
