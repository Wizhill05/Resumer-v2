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
          <span className="w-4 h-4 bg-[#ff4e26] border-2 border-black pixel-bounce-1" />
          <span className="w-4 h-4 bg-yellow-400 border-2 border-black pixel-bounce-2" />
          <span className="w-4 h-4 bg-[#ff4e26] border-2 border-black pixel-bounce-3" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 bg-red-100 border-3 border-black text-black shadow-[4px_4px_0px_#000000] flex gap-3 items-center">
        <AlertCircle className="shrink-0 text-red-600" />
        <p className="text-sm font-bold">Error: {error instanceof Error ? error.message : String(error)}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-4 border-2 border-black shadow-[2px_2px_0px_#000000]">
        <h3 className="text-sm font-extrabold uppercase tracking-wider">{runs.length} generations</h3>
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="border-transparent hover:border-black font-bold">
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>

      {runs.length === 0 ? (
        <div className="p-12 border-3 border-black bg-white text-center shadow-[4px_4px_0px_#000000]">
          <FileText className="mx-auto text-black mb-3" size={36} />
          <h4 className="font-extrabold text-lg uppercase tracking-wider mb-1">No generations yet</h4>
          <p className="text-sm font-medium text-zinc-700">Your tailored resumes will appear here once generated.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {runs.map((run) => (
            <div
              key={run.id}
              className="p-5 border-3 border-black bg-white flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-[4px_4px_0px_#000000] hover:-translate-y-0.5 hover:shadow-[5px_5px_0px_#000000] transition-all"
            >
              <div className="space-y-2">
                <div className="flex gap-3 items-center flex-wrap">
                  <h4 className="font-extrabold text-black text-lg uppercase tracking-tight">
                    {run.job_title || "Tailored Resume"}
                  </h4>
                  {run.company && (
                    <span className="bg-yellow-100 border border-black px-2 py-0.5 text-xs font-bold uppercase">
                      at {run.company}
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
                    className="uppercase tracking-wider font-extrabold"
                  >
                    {run.status}
                  </Badge>
                </div>

                <div className="flex gap-4 text-xs font-bold text-zinc-600 pt-1 flex-wrap uppercase">
                  <span className="flex items-center gap-1">
                    <Calendar size={12} className="text-black" />
                    {new Date(run.created_at).toLocaleDateString()}
                  </span>
                  <span>Template: {run.template_id}</span>
                  <span>Model: {run.model_used}</span>
                </div>
              </div>

              <div className="flex gap-2 w-full md:w-auto justify-end">
                {run.status === "completed" && (
                  <Button
                    onClick={() => window.open(`/api/backend/generate/${run.id}/download`, "_blank")}
                    size="sm"
                    className="w-full md:w-auto"
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
