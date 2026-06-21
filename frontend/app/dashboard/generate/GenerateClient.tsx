"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card } from "@/components/ui/card"
import { Loader2, Terminal, Download, FileText, CheckCircle2, AlertCircle } from "lucide-react"

type Step = "input" | "generating" | "result"
type LogEntry = {
  node: string
  message: string
  level: string
}

export function GenerateClient() {
  const [step, setStep] = useState<Step>("input")
  const [selectedTemplate, setSelectedTemplate] = useState<string>("clean-modern")
  const [jobDescription, setJobDescription] = useState("")
  const [keywords, setKeywords] = useState("")
  const [instructions, setInstructions] = useState("")
  const [generationId, setGenerationId] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [isDone, setIsDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch available templates
  const { data: templates = [], isLoading: isLoadingTemplates } = useQuery<any[]>({
    queryKey: ["templates"],
    queryFn: async () => {
      const res = await fetch("/api/backend/templates")
      if (!res.ok) throw new Error("Failed to load templates")
      return res.json()
    },
  })

  // Start generation run
  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!jobDescription.trim()) return

    setStep("generating")
    setLogs([])
    setIsDone(false)
    setError(null)

    try {
      const response = await fetch("/api/backend/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: selectedTemplate,
          job_description: jobDescription,
          keywords: keywords ? keywords.split(",").map((k) => k.trim()) : [],
          instructions: instructions || null,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || "Failed to start generation")
      }

      const run = await response.json()
      setGenerationId(run.id)

      // Start reading stream
      readStream(run.id)
    } catch (err: any) {
      setError(err.message)
      setStep("input")
    }
  }

  // Consume SSE logs stream from backend
  const readStream = async (genId: string) => {
    try {
      const response = await fetch(`/api/backend/generate/${genId}/stream`)
      if (!response.ok) {
        throw new Error("Failed to connect to log stream")
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) {
        throw new Error("ReadableStream not supported")
      }

      let buffer = ""

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue

          if (trimmed.startsWith("data: ")) {
            const dataStr = trimmed.slice(6).trim()
            if (dataStr === "[DONE]") {
              setIsDone(true)
              setStep("result")
              break
            }

            try {
              const log: LogEntry = JSON.parse(dataStr)
              setLogs((prev) => [...prev, log])
            } catch (e) {
              // Ignore line parsing errors
            }
          }
        }
      }
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleDownload = () => {
    if (!generationId) return
    window.open(`/api/backend/generate/${generationId}/preview`, "_blank")
  }

  if (isLoadingTemplates) {
    return (
      <div className="flex justify-center items-center py-20">
        <Loader2 className="animate-spin text-zinc-400" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {error && (
        <div className="p-4 bg-red-950/40 border border-red-800 text-red-300 rounded-xl flex gap-3 items-center">
          <AlertCircle className="shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {step === "input" && (
        <form onSubmit={handleGenerate} className="space-y-6">
          {/* Template Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold">1. Choose Template</Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {templates.map((tpl) => (
                <Card
                  key={tpl.id}
                  onClick={() => setSelectedTemplate(tpl.id)}
                  className={`p-4 cursor-pointer border bg-zinc-900/40 transition-colors ${
                    selectedTemplate === tpl.id
                      ? "border-blue-500 shadow-md shadow-blue-500/10"
                      : "border-zinc-800 hover:border-zinc-700"
                  }`}
                >
                  <div className="flex gap-3">
                    <FileText className="text-zinc-400 shrink-0" />
                    <div>
                      <h4 className="font-semibold text-white text-sm">{tpl.name}</h4>
                      <p className="text-xs text-zinc-400 mt-1">{tpl.description}</p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>

          {/* Job Description Textarea */}
          <div className="space-y-2">
            <Label htmlFor="job" className="text-sm font-semibold">2. Paste Job Description</Label>
            <Textarea
              id="job"
              required
              rows={8}
              placeholder="Paste the full job post details here..."
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              className="bg-zinc-900 border-zinc-850 text-white"
            />
          </div>

          {/* Keywords & Instructions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="keywords">Focus Keywords (optional, comma separated)</Label>
              <Input
                id="keywords"
                placeholder="Python, AWS, Next.js"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                className="bg-zinc-900 border-zinc-850 text-white"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="instructions">Custom Instructions (optional)</Label>
              <Input
                id="instructions"
                placeholder="e.g. emphasize my backend capabilities"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                className="bg-zinc-900 border-zinc-850 text-white"
              />
            </div>
          </div>

          <Button type="submit" size="lg" className="w-full bg-blue-600 hover:bg-blue-700 text-white">
            Start Generation Pipeline
          </Button>
        </form>
      )}

      {step === "generating" && (
        <div className="space-y-6">
          <div className="flex justify-between items-center bg-zinc-900/40 p-4 border border-zinc-850 rounded-xl">
            <div className="flex gap-3 items-center">
              <Loader2 className="animate-spin text-blue-500" />
              <div>
                <h3 className="font-semibold text-white">Generating Resume...</h3>
                <p className="text-xs text-zinc-400 mt-0.5">Please wait, agents are executing graph nodes.</p>
              </div>
            </div>
          </div>

          {/* Terminal Logs window */}
          <div className="rounded-xl border border-zinc-850 bg-black overflow-hidden">
            <div className="bg-zinc-900/60 px-4 py-2 border-b border-zinc-850 flex items-center gap-2">
              <Terminal size={14} className="text-zinc-500" />
              <span className="text-xs font-mono text-zinc-400">pipeline_logs.sh</span>
            </div>
            <div className="p-4 font-mono text-xs text-zinc-300 space-y-2 max-h-[350px] overflow-y-auto">
              {logs.map((log, idx) => (
                <div
                  key={idx}
                  className={
                    log.level === "error"
                      ? "text-red-400"
                      : log.level === "warning"
                      ? "text-yellow-400"
                      : "text-zinc-300"
                  }
                >
                  <span className="text-zinc-500 mr-2">[{log.node}]</span>
                  {log.message}
                </div>
              ))}
              {logs.length === 0 && (
                <div className="text-zinc-500">Initializing streaming pipeline context...</div>
              )}
            </div>
          </div>
        </div>
      )}

      {step === "result" && (
        <div className="space-y-6">
          <div className="flex justify-between items-center bg-zinc-900/40 p-4 border border-zinc-850 rounded-xl">
            <div className="flex gap-3 items-center">
              <CheckCircle2 className="text-green-500 shrink-0" />
              <div>
                <h3 className="font-semibold text-white">Resume Tailored Successfully!</h3>
                <p className="text-xs text-zinc-400 mt-0.5">A customized version of your resume matches the job requirements.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleDownload} className="bg-blue-600 hover:bg-blue-700 text-white flex gap-2 items-center">
                <Download size={16} /> Open/Download PDF
              </Button>
              <Button variant="outline" onClick={() => setStep("input")} className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 bg-transparent">
                Tailor Another
              </Button>
            </div>
          </div>

          {/* PDF Preview Container */}
          {generationId && (
            <div className="rounded-xl border border-zinc-850 overflow-hidden bg-zinc-900/10 h-[650px] relative">
              <iframe
                src={`/api/backend/generate/${generationId}/preview`}
                className="w-full h-full border-none"
                title="Resume PDF Preview"
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
