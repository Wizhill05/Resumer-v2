"use client"

import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Calendar, FileText, Download, AlertCircle, RefreshCw } from "lucide-react"

type HistoryRun = {
  id: string
  job_title?: string
  company?: string
  status: string
  created_at: string
  template_id: string
  model_used: string
}

export function HistoryClient() {
  const { data: runs = [], isLoading, error, refetch } = useQuery<HistoryRun[]>({
    queryKey: ["history"],
    queryFn: async () => {
      const res = await fetch("/api/backend/generate")
      if (!res.ok) throw new Error("Failed to load history")
      return res.json()
    },
  })

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-20">
        <div className="flex gap-2">
          <span className="w-3 h-3 bg-[#ff4e26] rounded-full pulse-dot-1" />
          <span className="w-3 h-3 bg-zinc-300 rounded-full pulse-dot-2" />
          <span className="w-3 h-3 bg-[#ff4e26] rounded-full pulse-dot-3" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-100 text-red-700 rounded-2xl flex gap-3 items-center">
        <AlertCircle className="shrink-0 text-red-600" />
        <p className="text-sm font-semibold">Error: {error instanceof Error ? error.message : String(error)}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-4 border border-zinc-100 rounded-2xl shadow-sm">
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">{runs.length} generations</h3>
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="font-bold flex gap-1.5 items-center">
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>

      {runs.length === 0 ? (
        <div className="p-12 border border-zinc-100 bg-white text-center rounded-3xl shadow-sm">
          <FileText className="mx-auto text-zinc-400 mb-3" size={36} />
          <h4 className="font-heading text-lg font-bold uppercase tracking-wider text-zinc-900 mb-1">No runs yet</h4>
          <p className="text-sm font-medium text-zinc-500">Your tailored resumes will appear here once generated.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {runs.map((run) => (
            <div
              key={run.id}
              className="editorial-card p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white"
            >
              <div className="space-y-2">
                <div className="flex gap-3 items-center flex-wrap">
                  <h4 className="font-heading text-lg font-bold uppercase tracking-tight text-zinc-900">
                    {run.job_title || "Tailored Resume"}
                  </h4>
                  {run.company && (
                    <span className="bg-orange-50/50 text-[#ff4e26] border border-orange-100/55 px-2 py-0.5 text-[10px] font-bold rounded-full uppercase tracking-wider">
                      {run.company}
                    </span>
                  )}
                  <Badge
                    variant={
                      run.status === "completed"
                        ? "default"
                        : run.status === "failed"
                        ? "destructive"
                        : "secondary"
                    }
                    className="text-[10px] tracking-widest font-extrabold"
                  >
                    {run.status}
                  </Badge>
                </div>

                <div className="flex gap-4 text-[10px] font-bold text-zinc-400 flex-wrap uppercase tracking-wider">
                  <span className="flex items-center gap-1">
                    <Calendar size={12} className="text-zinc-400" />
                    {new Date(run.created_at).toLocaleDateString()}
                  </span>
                  <span>Template: {run.template_id}</span>
                  <span>Model: {run.model_used}</span>
                </div>
              </div>

              <div className="flex gap-2 w-full sm:w-auto justify-end">
                {run.status === "completed" && (
                  <Button
                    onClick={() => window.open(`/api/backend/generate/${run.id}/download`, "_blank")}
                    size="sm"
                    className="w-full sm:w-auto"
                  >
                    <Download size={14} /> Download PDF
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
