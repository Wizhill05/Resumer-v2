"use client"

import React, { useState, useEffect, useRef, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  X,
  Terminal,
  FileCode,
  Download,
  Layers,
} from "lucide-react"
import { GenerationItem, GenerationNodeDetail, LogItem } from "./types"

interface GenerationTraceDrawerProps {
  generationId: string | null
  isOpen: boolean
  onClose: () => void
  generationMeta?: GenerationItem
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.statusText}`)
  }
  return res.json()
}

export function GenerationTraceDrawer({
  generationId,
  isOpen,
  onClose,
  generationMeta,
}: GenerationTraceDrawerProps) {
  const [activeSubTab, setActiveSubTab] = useState<"timeline" | "logs" | "artifacts">("timeline")
  const [streamLogs, setStreamLogs] = useState<LogItem[]>([])
  const [logLevelFilter, setLogLevelFilter] = useState<string>("ALL")
  const [streamActive, setStreamActive] = useState<boolean>(false)
  const streamRef = useRef<EventSource | null>(null)
  const terminalEndRef = useRef<HTMLDivElement | null>(null)

  // 1. Fetch Node-by-Node details
  const { data: nodeDetails = [], isLoading: loadingNodes } = useQuery<GenerationNodeDetail[]>({
    queryKey: ["admin-gen-nodes", generationId],
    queryFn: () => fetchJson<GenerationNodeDetail[]>(`/api/backend/admin/generations/${generationId}/nodes`),
    enabled: isOpen && !!generationId,
  })

  // 2. Fetch Static DB Logs
  const { data: dbLogs = [] } = useQuery<LogItem[]>({
    queryKey: ["admin-gen-logs", generationId],
    queryFn: () => fetchJson<LogItem[]>(`/api/backend/admin/generations/${generationId}/logs`),
    enabled: isOpen && !!generationId,
  })

  // SSE Stream for in-flight generations
  useEffect(() => {
    if (!isOpen || !generationId) {
      if (streamRef.current) {
        streamRef.current.close()
        streamRef.current = null
      }
      return
    }

    if (generationMeta?.status === "generating" || generationMeta?.status === "pending") {
      const sse = new EventSource(`/api/backend/admin/generations/${generationId}/logs/stream`)
      streamRef.current = sse

      sse.onopen = () => {
        setStreamActive(true)
      }

      sse.onmessage = (event) => {
        try {
          const logData = JSON.parse(event.data)
          setStreamLogs((prev) => [...prev, logData])
        } catch {
          // ignore malformed SSE frames
        }
      }

      sse.onerror = () => {
        sse.close()
        setStreamActive(false)
      }

      return () => {
        sse.close()
        streamRef.current = null
      }
    }
  }, [isOpen, generationId, generationMeta?.status])

  const displayLogs = useMemo(() => {
    return streamLogs.length > 0 ? [...dbLogs, ...streamLogs] : dbLogs
  }, [dbLogs, streamLogs])

  // Scroll to bottom when logs update
  useEffect(() => {
    if (activeSubTab === "logs") {
      terminalEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [displayLogs, activeSubTab])

  if (!isOpen || !generationId) return null

  const filteredLogs = logLevelFilter === "ALL"
    ? displayLogs
    : displayLogs.filter((l) => l.level.toUpperCase() === logLevelFilter)

  const totalTokensUsed = nodeDetails.reduce((acc, n) => acc + (n.total_tokens || 0), 0)
  const intermediateCount = generationMeta?.intermediate_resume_count ?? 0

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/70 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-zinc-800 bg-zinc-950 text-white shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-zinc-800 bg-zinc-900/90 p-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#ff4e26]">
                Trace Inspector
              </span>
              <span className="border border-zinc-700 bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-300">
                {generationId.slice(0, 8)}...
              </span>
              {streamActive && (
                <span className="flex items-center gap-1 border border-emerald-700 bg-emerald-950 px-2 py-0.5 font-mono text-[10px] text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                  LIVE STREAM
                </span>
              )}
            </div>
            <h2 className="mt-1 text-base font-extrabold uppercase text-white">
              {generationMeta?.job_title || "Resume Generation Trace"}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-3 font-mono text-xs text-zinc-400">
              <span>{generationMeta?.email || "Guest"}</span>
              <span>&bull;</span>
              <span>Model: {generationMeta?.model_used || "Standard"}</span>
              <span>&bull;</span>
              <span className={generationMeta?.status === "completed" ? "text-emerald-400 font-bold uppercase" : generationMeta?.status === "failed" ? "text-red-400 font-bold uppercase" : "text-amber-400 font-bold uppercase"}>
                {generationMeta?.status || "Status Unknown"}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center border border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-white hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        {/* Sub-tab Navigation */}
        <div className="flex border-b border-zinc-800 bg-zinc-900/50 px-4">
          <button
            type="button"
            onClick={() => setActiveSubTab("timeline")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-wider transition-colors ${
              activeSubTab === "timeline"
                ? "border-[#ff4e26] text-white bg-zinc-900"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Layers size={14} />
            Timeline ({nodeDetails.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab("logs")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-wider transition-colors ${
              activeSubTab === "logs"
                ? "border-[#ff4e26] text-white bg-zinc-900"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Terminal size={14} />
            Stdout Logs ({displayLogs.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab("artifacts")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-wider transition-colors ${
              activeSubTab === "artifacts"
                ? "border-[#ff4e26] text-white bg-zinc-900"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <FileCode size={14} />
            Artifacts ({intermediateCount})
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* TAB 1: NODE TIMELINE */}
          {activeSubTab === "timeline" && (
            <div className="space-y-3">
              {/* Summary Stats bar */}
              <div className="grid grid-cols-3 gap-2 border border-zinc-800 bg-zinc-900 p-3 text-center font-mono text-xs">
                <div>
                  <span className="text-[10px] text-zinc-500 block">TOTAL NODES</span>
                  <span className="font-bold text-white">{nodeDetails.length}</span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 block">TOTAL TOKENS</span>
                  <span className="font-bold text-[#ff4e26]">{totalTokensUsed.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 block">DURATION</span>
                  <span className="font-bold text-white">
                    {generationMeta?.duration_seconds != null ? `${generationMeta.duration_seconds.toFixed(1)}s` : "In flight"}
                  </span>
                </div>
              </div>

              {loadingNodes ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((n) => (
                    <div key={n} className="h-20 border border-zinc-800 bg-zinc-900/60 animate-pulse" />
                  ))}
                </div>
              ) : nodeDetails.length === 0 ? (
                <div className="border border-dashed border-zinc-800 p-8 text-center font-mono text-xs text-zinc-500">
                  No individual node metric records found for this generation.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {nodeDetails.map((node, index) => {
                    const isSuccess = node.status === "completed" || node.status === "success"
                    return (
                      <div
                        key={node.id || index}
                        className={`border p-3 font-mono text-xs transition-colors ${
                          isSuccess
                            ? "border-zinc-800 bg-zinc-900/80 hover:border-zinc-700"
                            : "border-red-900 bg-red-950/40"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="flex h-5 w-5 items-center justify-center bg-zinc-800 text-[10px] font-bold text-zinc-400">
                              {index + 1}
                            </span>
                            <span className="font-bold uppercase text-white">{node.node_name}</span>
                            <span className="border border-zinc-700 bg-zinc-800 px-1.5 text-[10px] text-zinc-300">
                              {node.provider}
                            </span>
                          </div>
                          <span
                            className={`px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                              isSuccess ? "bg-emerald-950 text-emerald-400 border border-emerald-800" : "bg-red-950 text-red-400 border border-red-800"
                            }`}
                          >
                            {node.status}
                          </span>
                        </div>

                        <div className="mt-2 grid grid-cols-3 gap-2 border-t border-zinc-800/80 pt-2 text-[11px] text-zinc-400">
                          <div>
                            <span className="text-zinc-600">Model:</span>{" "}
                            <span className="text-zinc-200">{node.model || "default"}</span>
                          </div>
                          <div>
                            <span className="text-zinc-600">Latency:</span>{" "}
                            <span className="text-zinc-200">{node.latency_ms != null ? `${node.latency_ms}ms` : "-"}</span>
                          </div>
                          <div>
                            <span className="text-zinc-600">Tokens:</span>{" "}
                            <span className="text-zinc-200">{node.total_tokens ?? "-"}</span>
                          </div>
                        </div>

                        {/* Badges / Errors */}
                        {(node.fallback_used || node.parse_error || node.error_message) && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 pt-1">
                            {node.fallback_used && (
                              <span className="border border-amber-800 bg-amber-950 px-1.5 py-0.5 text-[10px] font-bold text-amber-300 uppercase">
                                Fallback Invoked
                              </span>
                            )}
                            {node.parse_error && (
                              <span className="border border-red-800 bg-red-950 px-1.5 py-0.5 text-[10px] font-bold text-red-300 uppercase">
                                JSON Parse Error
                              </span>
                            )}
                            {node.error_message && (
                              <p className="mt-1 w-full border border-red-900 bg-red-950/80 p-2 text-[11px] text-red-200">
                                {node.error_message}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: TERMINAL LOGS */}
          {activeSubTab === "logs" && (
            <div className="space-y-3">
              {/* Log filter bar */}
              <div className="flex items-center justify-between border border-zinc-800 bg-zinc-900 p-2 font-mono text-xs">
                <div className="flex items-center gap-1">
                  <span className="text-zinc-400 text-[10px] uppercase">Level:</span>
                  {["ALL", "INFO", "WARN", "ERROR"].map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setLogLevelFilter(lvl)}
                      className={`px-2 py-0.5 font-bold uppercase transition-colors ${
                        logLevelFilter === lvl
                          ? "bg-[#ff4e26] text-white"
                          : "text-zinc-400 hover:text-white"
                      }`}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-zinc-500">
                  {filteredLogs.length} line{filteredLogs.length === 1 ? "" : "s"}
                </span>
              </div>

              {/* Terminal Box */}
              <div className="h-[460px] overflow-y-auto border border-zinc-800 bg-black p-3 font-mono text-xs leading-relaxed text-zinc-300">
                {filteredLogs.length === 0 ? (
                  <p className="text-zinc-600">No logs matching current filter.</p>
                ) : (
                  filteredLogs.map((log, i) => {
                    const isError = log.level.toUpperCase() === "ERROR"
                    const isWarn = log.level.toUpperCase() === "WARN" || log.level.toUpperCase() === "WARNING"
                    return (
                      <div key={log.id || i} className="flex items-start gap-2 py-0.5">
                        <span className="text-zinc-600 shrink-0 text-[10px]">
                          {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : "--:--:--"}
                        </span>
                        <span
                          className={`font-bold shrink-0 text-[10px] uppercase ${
                            isError ? "text-red-400" : isWarn ? "text-amber-400" : "text-emerald-400"
                          }`}
                        >
                          [{log.level}]
                        </span>
                        {log.node_name && (
                          <span className="text-zinc-500 shrink-0 text-[10px]">
                            ({log.node_name})
                          </span>
                        )}
                        <span className={`break-all ${isError ? "text-red-300" : "text-zinc-200"}`}>
                          {log.message}
                        </span>
                      </div>
                    )
                  })
                )}
                <div ref={terminalEndRef} />
              </div>
            </div>
          )}

          {/* TAB 3: INTERMEDIATE ARTIFACTS */}
          {activeSubTab === "artifacts" && (
            <div className="space-y-3 font-mono text-xs">
              <p className="text-zinc-400">
                Download intermediate resume JSON snapshots generated during iterative tailoring nodes.
              </p>

              {intermediateCount === 0 ? (
                <div className="border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
                  No intermediate resume snapshots were produced for this run.
                </div>
              ) : (
                <div className="space-y-2">
                  {Array.from({ length: intermediateCount }).map((_, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between border border-zinc-800 bg-zinc-900 p-3"
                    >
                      <div>
                        <span className="font-bold text-white uppercase">Iteration #{index + 1}</span>
                        <span className="ml-2 text-zinc-500 text-[11px]">
                          (Snapshot index {index})
                        </span>
                      </div>
                      <a
                        href={`/api/backend/admin/generations/${generationId}/intermediate/${index}/download`}
                        download={`generation_${generationId}_intermediate_${index}.json`}
                        className="flex items-center gap-1.5 border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs font-bold text-zinc-200 hover:border-[#ff4e26] hover:text-white transition-colors"
                      >
                        <Download size={13} />
                        Download JSON
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
