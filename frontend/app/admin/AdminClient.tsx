"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { 
  BarChart2, 
  Settings, 
  RefreshCw, 
  Trash2, 
  Users, 
  FileText, 
  Terminal, 
  Lock, 
  ArrowLeft 
} from "lucide-react"

type AnalyticsData = {
  total_users: number
  total_generations: number
  generations_by_status: Record<string, number>
  total_guest_generations: number
  average_generation_latency_seconds: number
  failure_rate_percent: number
  keys_status: {
    cerebras: { configured_keys_count: number }
    google: { configured_keys_count: number }
  }
}

type PromptConfig = {
  name: string
  system_prompt: string
  user_prompt?: string
  updated_at?: string
}

type GenerationItem = {
  id: string
  user_id: string
  email?: string
  template_id: string
  job_title?: string
  company?: string
  model_used: string
  status: string
  created_at: string
  completed_at?: string
  is_guest: boolean
  error_message?: string
}

type UserItem = {
  id: string
  email: string
  name?: string
  created_at: string
  provider?: string
  request_count: number
  reset_at?: string
}

type LogItem = {
  id: number
  timestamp: string
  level: string
  message: string
  node_name?: string
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    if (res.status === 401) throw new Error("Unauthorized")
    if (res.status === 403) throw new Error("Access Denied")
    throw new Error(`Failed to load ${url}`)
  }
  return res.json()
}

export function AdminClient() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<"analytics" | "generations" | "prompts" | "users">("analytics")
  
  // States for Prompt editor
  const [selectedPrompt, setSelectedPrompt] = useState<PromptConfig | null>(null)
  const [systemPromptVal, setSystemPromptVal] = useState("")
  const [userPromptVal, setUserPromptVal] = useState("")

  // States for log view
  const [viewingLogsGenId, setViewingLogsGenId] = useState<string | null>(null)

  // States for rate limit edit
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [newLimitVal, setNewLimitVal] = useState(5)

  // 1. Fetch Analytics
  const { data: analytics, error: analyticsErr, isLoading: loadingAnalytics } = useQuery<AnalyticsData>({
    queryKey: ["admin", "analytics"],
    queryFn: () => fetchJson<AnalyticsData>("/api/backend/admin/analytics"),
  })

  // 2. Fetch Prompts
  const { data: prompts = [], isLoading: loadingPrompts } = useQuery<PromptConfig[]>({
    queryKey: ["admin", "prompts"],
    queryFn: () => fetchJson<PromptConfig[]>("/api/backend/admin/prompts"),
    enabled: activeTab === "prompts",
  })

  // 3. Fetch Generations
  const { data: generations = [], isLoading: loadingGenerations } = useQuery<GenerationItem[]>({
    queryKey: ["admin", "generations"],
    queryFn: () => fetchJson<GenerationItem[]>("/api/backend/admin/generations?limit=50"),
    enabled: activeTab === "generations",
  })

  // 4. Fetch Users
  const { data: users = [], isLoading: loadingUsers } = useQuery<UserItem[]>({
    queryKey: ["admin", "users"],
    queryFn: () => fetchJson<UserItem[]>("/api/backend/admin/users?limit=50"),
    enabled: activeTab === "users",
  })

  // 5. Fetch logs for selected generation
  const { data: logs = [], isLoading: loadingLogs } = useQuery<LogItem[]>({
    queryKey: ["admin", "logs", viewingLogsGenId],
    queryFn: () => fetchJson<LogItem[]>(`/api/backend/admin/generations/${viewingLogsGenId}/logs`),
    enabled: !!viewingLogsGenId,
  })

  // Mutations
  const updatePromptMutation = useMutation({
    mutationFn: async (payload: { name: string; system_prompt: string; user_prompt?: string }) => {
      const res = await fetch(`/api/backend/admin/prompts/${payload.name}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error("Failed to save prompt config")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "prompts"] })
      alert("Prompt updated successfully!")
    },
  })

  const retryGenMutation = useMutation({
    mutationFn: async (genId: string) => {
      const res = await fetch(`/api/backend/admin/generations/${genId}/retry`, {
        method: "POST",
      })
      if (!res.ok) throw new Error("Failed to retry generation")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "generations"] })
      alert("Generation restarted successfully!")
    },
  })

  const deleteGenMutation = useMutation({
    mutationFn: async (genId: string) => {
      const res = await fetch(`/api/backend/admin/generations/${genId}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error("Failed to delete generation")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "generations"] })
    },
  })

  const updateRateLimitMutation = useMutation({
    mutationFn: async (payload: { userId: string; request_count: number }) => {
      const res = await fetch(`/api/backend/admin/users/${payload.userId}/rate-limit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_count: payload.request_count }),
      })
      if (!res.ok) throw new Error("Failed to update rate limit")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
      setEditingUserId(null)
    },
  })

  // Access check
  if (analyticsErr?.message === "Access Denied" || analyticsErr?.message === "Unauthorized") {
    return (
      <div className="mx-auto max-w-md p-8 text-center bg-white border border-zinc-200 mt-12 pixel-enter">
        <Lock className="mx-auto text-red-500 mb-4" size={48} />
        <h2 className="text-xl font-bold uppercase text-red-600">Access Denied</h2>
        <p className="mt-2 text-zinc-600 text-sm font-semibold">
          Your account does not have admin permissions to access this control panel.
        </p>
      </div>
    )
  }

  const selectPromptForEditing = (p: PromptConfig) => {
    setSelectedPrompt(p)
    setSystemPromptVal(p.system_prompt)
    setUserPromptVal(p.user_prompt || "")
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
      {/* Tab select bar */}
      <div className="flex flex-wrap gap-2 border-b border-zinc-200 pb-3 mb-6">
        <Button 
          variant={activeTab === "analytics" ? "default" : "outline"} 
          onClick={() => setActiveTab("analytics")}
          size="sm"
        >
          <BarChart2 className="mr-2" size={16} /> Analytics
        </Button>
        <Button 
          variant={activeTab === "generations" ? "default" : "outline"} 
          onClick={() => setActiveTab("generations")}
          size="sm"
        >
          <FileText className="mr-2" size={16} /> Generations
        </Button>
        <Button 
          variant={activeTab === "prompts" ? "default" : "outline"} 
          onClick={() => setActiveTab("prompts")}
          size="sm"
        >
          <Settings className="mr-2" size={16} /> Prompt Manager
        </Button>
        <Button 
          variant={activeTab === "users" ? "default" : "outline"} 
          onClick={() => setActiveTab("users")}
          size="sm"
        >
          <Users className="mr-2" size={16} /> User Rate Limits
        </Button>
      </div>

      {/* ANALYTICS TAB */}
      {activeTab === "analytics" && (
        <div className="space-y-6 pixel-enter">
          {loadingAnalytics ? (
            <div className="soft-skeleton h-48" />
          ) : analytics ? (
            <>
              {/* Stat grid */}
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
                <div className="panel-strong bg-white p-4">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">Total Users</p>
                  <p className="text-3xl font-black text-black mt-1">{analytics.total_users}</p>
                </div>
                <div className="panel-strong bg-white p-4">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">Total Builds</p>
                  <p className="text-3xl font-black text-[#ff4e26] mt-1">{analytics.total_generations}</p>
                </div>
                <div className="panel-strong bg-white p-4">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">Avg Latency</p>
                  <p className="text-3xl font-black text-black mt-1">{analytics.average_generation_latency_seconds}s</p>
                </div>
                <div className="panel-strong bg-white p-4">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">LLM Failure Rate</p>
                  <p className="text-3xl font-black mt-1 text-red-600">{analytics.failure_rate_percent}%</p>
                </div>
              </div>

              {/* Advanced info section */}
              <div className="grid gap-6 md:grid-cols-2">
                {/* Generation Queue Breakdown */}
                <div className="panel-strong bg-white p-5 space-y-4">
                  <h3 className="text-sm font-bold uppercase tracking-wide border-b pb-2 text-zinc-800">Generation Queue</h3>
                  <div className="space-y-3">
                    {Object.entries(analytics.generations_by_status).map(([status, count]) => {
                      const percent = analytics.total_generations > 0 ? (count / analytics.total_generations * 100) : 0
                      let barColor = "bg-zinc-500"
                      if (status === "completed") barColor = "bg-green-500"
                      if (status === "failed") barColor = "bg-red-500"
                      if (status === "in_progress") barColor = "bg-[#ff4e26]"

                      return (
                        <div key={status} className="space-y-1">
                          <div className="flex justify-between text-xs font-semibold">
                            <span className="capitalize">{status}</span>
                            <span>{count} ({Math.round(percent)}%)</span>
                          </div>
                          <div className="w-full bg-zinc-100 h-2.5 rounded-none overflow-hidden">
                            <div className={`h-full ${barColor}`} style={{ width: `${percent}%` }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* API Key pool Status */}
                <div className="panel-strong bg-white p-5 space-y-4">
                  <h3 className="text-sm font-bold uppercase tracking-wide border-b pb-2 text-zinc-800">LLM Api Key Pools</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="border border-zinc-200 p-4 text-center bg-zinc-50">
                      <p className="text-xs font-bold text-zinc-600 uppercase">Cerebras Keys</p>
                      <p className="text-2xl font-black text-black mt-1">{analytics.keys_status.cerebras.configured_keys_count}</p>
                      <span className="text-[10px] text-green-600 font-bold uppercase">Online (Primary)</span>
                    </div>
                    <div className="border border-zinc-200 p-4 text-center bg-zinc-50">
                      <p className="text-xs font-bold text-zinc-600 uppercase">Google Keys</p>
                      <p className="text-2xl font-black text-black mt-1">{analytics.keys_status.google.configured_keys_count}</p>
                      <span className="text-[10px] text-amber-600 font-bold uppercase">Online (Fallback)</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-zinc-500 font-semibold italic">
                    Keys are managed via environment variables and loaded in a round-robin rotation.
                  </p>
                </div>
              </div>
            </>
          ) : (
            <p>No data loaded.</p>
          )}
        </div>
      )}

      {/* GENERATIONS TAB */}
      {activeTab === "generations" && (
        <div className="space-y-4 pixel-enter">
          {viewingLogsGenId ? (
            <div className="panel-strong bg-white p-5 space-y-4">
              <div className="flex justify-between items-center border-b pb-3">
                <h3 className="font-bold uppercase text-sm tracking-wide">Logs for Generation {viewingLogsGenId}</h3>
                <Button size="xs" variant="outline" onClick={() => setViewingLogsGenId(null)}>
                  <ArrowLeft className="mr-1" size={12} /> Back to generations
                </Button>
              </div>

              {loadingLogs ? (
                <div className="soft-skeleton h-40" />
              ) : logs.length === 0 ? (
                <p className="text-xs text-zinc-500 font-semibold italic text-center py-8">No logs found for this run.</p>
              ) : (
                <div className="bg-zinc-950 p-4 text-white font-mono text-xs overflow-y-auto max-h-[450px] space-y-1.5 leading-relaxed">
                  {logs.map((log) => {
                    let levelColor = "text-zinc-400"
                    if (log.level === "error") levelColor = "text-red-400"
                    if (log.level === "warning") levelColor = "text-amber-400"

                    return (
                      <div key={log.id} className="flex gap-2 items-start">
                        <span className="text-zinc-500">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                        <span className={`uppercase font-bold ${levelColor}`}>[{log.level}]</span>
                        {log.node_name && <span className="text-cyan-400">[{log.node_name}]</span>}
                        <span className="flex-1 break-all">{log.message}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-sm font-bold uppercase tracking-wide">Recent Generations</h3>
                <Button size="xs" variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ["admin", "generations"] })}>
                  <RefreshCw size={12} className="mr-1" /> Refresh
                </Button>
              </div>

              {loadingGenerations ? (
                <div className="soft-skeleton h-64" />
              ) : generations.length === 0 ? (
                <p className="text-sm text-zinc-500 italic py-12 text-center bg-white border border-zinc-200">No generations run yet.</p>
              ) : (
                <div className="overflow-x-auto border border-zinc-200 bg-white">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-zinc-100 border-b border-zinc-200 font-bold text-zinc-700">
                        <th className="p-3">Job & User</th>
                        <th className="p-3">Model</th>
                        <th className="p-3">Status</th>
                        <th className="p-3">Created</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 font-medium">
                      {generations.map((gen) => {
                        let statusColor = "bg-zinc-100 text-zinc-700"
                        if (gen.status === "completed") statusColor = "bg-green-100 text-green-700"
                        if (gen.status === "failed") statusColor = "bg-red-100 text-red-700"
                        if (gen.status === "in_progress") statusColor = "bg-amber-100 text-amber-700 animate-pulse"

                        return (
                          <tr key={gen.id} className="hover:bg-zinc-50">
                            <td className="p-3">
                              <p className="font-extrabold uppercase text-black">
                                {gen.job_title || "Unknown title"}
                              </p>
                              <p className="text-[10px] text-zinc-500">
                                {gen.company || "No company"} &bull; {gen.email || (gen.is_guest ? "Guest" : gen.user_id)}
                              </p>
                            </td>
                            <td className="p-3 text-zinc-600 font-mono text-[10px]">{gen.model_used}</td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 font-bold uppercase text-[9px] ${statusColor}`}>
                                {gen.status}
                              </span>
                            </td>
                            <td className="p-3 text-zinc-500 font-mono text-[10px]">
                              {new Date(gen.created_at).toLocaleString()}
                            </td>
                            <td className="p-3 text-right space-x-1.5">
                              <Button 
                                size="xs" 
                                variant="outline" 
                                className="px-2"
                                onClick={() => setViewingLogsGenId(gen.id)}
                              >
                                <Terminal size={12} className="mr-1" /> Logs
                              </Button>
                              <Button 
                                size="xs" 
                                variant="outline"
                                className="px-2"
                                disabled={gen.status !== "failed"}
                                onClick={() => retryGenMutation.mutate(gen.id)}
                              >
                                <RefreshCw size={12} className="mr-1" /> Retry
                              </Button>
                              <Button 
                                size="xs" 
                                variant="ghost"
                                className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                onClick={() => {
                                  if (confirm("Delete this generation and its storage artifacts?")) {
                                    deleteGenMutation.mutate(gen.id)
                                  }
                                }}
                              >
                                <Trash2 size={12} />
                              </Button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* PROMPT MANAGER TAB */}
      {activeTab === "prompts" && (
        <div className="grid gap-6 md:grid-cols-[250px_1fr] pixel-enter">
          {/* Prompt Selection List */}
          <div className="panel-strong bg-white p-4 space-y-3">
            <h3 className="text-xs font-extrabold uppercase tracking-widest text-[#ff4e26]">Prompt list</h3>
            <div className="space-y-1">
              {loadingPrompts ? (
                <div className="soft-skeleton h-24" />
              ) : prompts.length === 0 ? (
                <p className="text-xs text-zinc-500 italic">No prompts registered in database. Run a generation to seed them.</p>
              ) : (
                prompts.map((p) => (
                  <button
                    key={p.name}
                    className={`w-full text-left px-3 py-2 text-xs font-semibold border transition-colors ${
                      selectedPrompt?.name === p.name
                        ? "border-[#ff4e26] bg-orange-50 text-[#ff4e26]"
                        : "border-zinc-200 hover:bg-zinc-50"
                    }`}
                    onClick={() => selectPromptForEditing(p)}
                  >
                    {p.name}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Prompt Editor */}
          <div className="panel-strong bg-white p-5 space-y-4">
            {selectedPrompt ? (
              <>
                <div className="flex justify-between items-center border-b pb-3">
                  <h3 className="font-bold text-black uppercase text-sm">Edit Prompt: {selectedPrompt.name}</h3>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    Last updated: {selectedPrompt.updated_at ? new Date(selectedPrompt.updated_at).toLocaleString() : "Never"}
                  </span>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="system-prompt" className="text-xs font-bold text-zinc-700">System Prompt</Label>
                    <Textarea 
                      id="system-prompt"
                      rows={12}
                      className="font-mono text-xs leading-relaxed"
                      value={systemPromptVal}
                      onChange={(e) => setSystemPromptVal(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="user-prompt" className="text-xs font-bold text-zinc-700">User Prompt Template (Optional)</Label>
                    <Textarea 
                      id="user-prompt"
                      rows={5}
                      className="font-mono text-xs leading-relaxed"
                      value={userPromptVal}
                      onChange={(e) => setUserPromptVal(e.target.value)}
                      placeholder="Enter user prompt template here (use {curly_braces} for variables)"
                    />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <Button 
                      disabled={updatePromptMutation.isPending}
                      onClick={() => updatePromptMutation.mutate({
                        name: selectedPrompt.name,
                        system_prompt: systemPromptVal,
                        user_prompt: userPromptVal || undefined
                      })}
                    >
                      {updatePromptMutation.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="h-64 flex items-center justify-center text-zinc-400 text-sm font-semibold italic">
                Select a prompt from the sidebar to view and edit its template.
              </div>
            )}
          </div>
        </div>
      )}

      {/* USER RATE LIMITS TAB */}
      {activeTab === "users" && (
        <div className="space-y-4 pixel-enter">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-sm font-bold uppercase tracking-wide">User Account Limit Overview</h3>
          </div>

          {loadingUsers ? (
            <div className="soft-skeleton h-64" />
          ) : (
            <div className="overflow-x-auto border border-zinc-200 bg-white">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-zinc-100 border-b border-zinc-200 font-bold text-zinc-700">
                    <th className="p-3">Name & Email</th>
                    <th className="p-3">Joined Date</th>
                    <th className="p-3">Used Count (24h)</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 font-medium">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-zinc-50">
                      <td className="p-3">
                        <p className="font-bold text-black">{u.name || "No name"}</p>
                        <p className="text-[10px] text-zinc-500">{u.email}</p>
                      </td>
                      <td className="p-3 text-zinc-500">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td className="p-3">
                        {editingUserId === u.id ? (
                          <div className="flex gap-2 items-center">
                            <Input 
                              type="number"
                              className="w-16 h-7 text-xs px-2"
                              value={newLimitVal}
                              onChange={(e) => setNewLimitVal(parseInt(e.target.value) || 0)}
                            />
                            <Button 
                              size="xs"
                              disabled={updateRateLimitMutation.isPending}
                              onClick={() => updateRateLimitMutation.mutate({
                                userId: u.id,
                                request_count: newLimitVal
                              })}
                            >
                              Save
                            </Button>
                            <Button size="xs" variant="ghost" onClick={() => setEditingUserId(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <span className="font-mono text-zinc-700">
                            {u.request_count} builds
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <Button 
                          size="xs" 
                          variant="outline"
                          onClick={() => {
                            setEditingUserId(u.id)
                            setNewLimitVal(u.request_count)
                          }}
                        >
                          Set Used Count
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
