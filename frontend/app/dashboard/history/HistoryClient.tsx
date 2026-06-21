"use client"

import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, Calendar, FileText, Download, AlertCircle, RefreshCw } from "lucide-react"

export function HistoryClient() {
  const { data: runs = [], isLoading, error, refetch } = useQuery<any[]>({
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
        <Loader2 className="animate-spin text-zinc-400" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 bg-red-950/40 border border-red-800 text-red-300 rounded-xl flex gap-3 items-center">
        <AlertCircle className="shrink-0" />
        <p className="text-sm">Error: {(error as any).message}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-sm font-medium text-zinc-400">{runs.length} generations</h3>
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="text-zinc-400 hover:text-white flex gap-1 items-center">
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>

      {runs.length === 0 ? (
        <Card className="p-8 border-zinc-800 bg-zinc-900/10 text-center">
          <FileText className="mx-auto text-zinc-500 mb-3" size={32} />
          <h4 className="font-semibold text-white mb-1">No generations yet</h4>
          <p className="text-sm text-zinc-400">Your tailored resumes will appear here once generated.</p>
        </Card>
      ) : (
        runs.map((run) => (
          <Card key={run.id} className="p-5 border-zinc-850 bg-zinc-900/30 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="space-y-1">
              <div className="flex gap-2 items-center flex-wrap">
                <h4 className="font-bold text-white text-base">
                  {run.job_title || "Tailored Resume"}
                </h4>
                {run.company && (
                  <span className="text-zinc-400 text-sm">at {run.company}</span>
                )}
                <Badge
                  className={
                    run.status === "completed"
                      ? "bg-green-950/60 text-green-300 border-green-800"
                      : run.status === "failed"
                      ? "bg-red-950/60 text-red-300 border-red-800"
                      : "bg-blue-950/60 text-blue-300 border-blue-800"
                  }
                >
                  {run.status}
                </Badge>
              </div>

              <div className="flex gap-4 text-xs text-zinc-500 pt-1 flex-wrap">
                <span className="flex items-center gap-1">
                  <Calendar size={12} />
                  {new Date(run.created_at).toLocaleDateString()}
                </span>
                <span>Template: {run.template_id}</span>
                <span>Model: {run.model_used}</span>
              </div>
            </div>

            <div className="flex gap-2 w-full md:w-auto justify-end">
              {run.status === "completed" && (
                <Button
                  onClick={() => window.open(`/api/backend/generate/${run.id}/preview`, "_blank")}
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700 text-white flex gap-1.5 items-center w-full md:w-auto"
                >
                  <Download size={14} /> Download PDF
                </Button>
              )}
            </div>
          </Card>
        ))
      )}
    </div>
  )
}
