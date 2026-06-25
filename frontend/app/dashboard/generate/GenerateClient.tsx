"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Download, FileText, CheckCircle2, AlertCircle, ArrowLeft } from "lucide-react"

type Step = "input" | "generating" | "result"
type LogEntry = {
  node: string
  message: string
  level: string
}

type TemplateItem = {
  id: string
  name: string
  description: string
}

export function GenerateClient() {
  const [step, setStep] = useState<Step>("input")
  const [selectedTemplate, setSelectedTemplate] = useState<string>("personal-classic")
  const [jobDescription, setJobDescription] = useState("")
  const [keywords, setKeywords] = useState("")
  const [instructions, setInstructions] = useState("")
  const [generationId, setGenerationId] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [isDone, setIsDone] = useState(false)
  const [pipelineStatus, setPipelineStatus] = useState<"completed" | "failed" | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Fetch available templates
  const { data: templates = [], isLoading: isLoadingTemplates } = useQuery<TemplateItem[]>({
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
    setPipelineStatus(null)
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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
              if (log.level === "status") {
                setPipelineStatus(log.message as "completed" | "failed")
              } else {
                setLogs((prev) => [...prev, log])
              }
            } catch {
              // Ignore line parsing errors
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDownload = () => {
    if (!generationId) return
    window.open(`/api/backend/generate/${generationId}/preview`, "_blank")
  }

  const getProgressAndStatus = () => {
    if (isDone || pipelineStatus === "completed") return { percent: 100, text: "Finished tailoring your resume!" }
    if (pipelineStatus === "failed") return { percent: 100, text: "Tailoring failed." }
    if (logs.length === 0) return { percent: 10, text: "Initializing agents and setting up state..." }

    const lastLog = logs[logs.length - 1]
    const node = lastLog?.node || ""

    switch (node) {
      case "job_analyzer":
      case "analyzer":
        return { percent: 25, text: "Analyzing job description & extracting keywords..." }
      case "summary_skills_writer":
      case "skills_writer":
        return { percent: 45, text: "Tailoring summary and core skills matching job requirements..." }
      case "project_selector":
      case "projects_writer":
        return { percent: 65, text: "Selecting relevant projects & adapting bullet points..." }
      case "experience_writer":
        return { percent: 80, text: "Aligning professional experience & formatting descriptions..." }
      case "render_pdf":
        return { percent: 95, text: "Rendering PDF template & executing page auto-fit..." }
      default:
        return { percent: 85, text: lastLog.message || "Running AI pipeline steps..." }
    }
  }

  if (isLoadingTemplates) {
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

  const progress = getProgressAndStatus()

  return (
    <div className="space-y-8">
      {error && (
        <div className="p-4 bg-red-100 border-3 border-black text-black shadow-[4px_4px_0px_#000000] flex gap-3 items-center">
          <AlertCircle className="shrink-0 text-red-600" />
          <p className="text-sm font-bold">{error}</p>
        </div>
      )}

      {step === "input" && (
        <form onSubmit={handleGenerate} className="space-y-8">
          {/* Template Selection */}
          <div className="space-y-4">
            <Label className="text-lg font-extrabold uppercase tracking-tight">1. Choose Template</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  onClick={() => setSelectedTemplate(tpl.id)}
                  className={`p-5 cursor-pointer border-3 border-black transition-all ${
                    selectedTemplate === tpl.id
                      ? "bg-[#ff4e26] text-white shadow-[4px_4px_0px_#000000]"
                      : "bg-white text-black shadow-[3px_3px_0px_#000000] hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_#000000]"
                  }`}
                >
                  <div className="flex gap-4">
                    <FileText className="shrink-0" />
                    <div>
                      <h4 className="font-extrabold text-sm uppercase tracking-wider">{tpl.name}</h4>
                      <p className={`text-xs mt-1 ${selectedTemplate === tpl.id ? "text-white/80" : "text-zinc-600"}`}>
                        {tpl.description}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Job Description Textarea */}
          <div className="space-y-3">
            <Label htmlFor="job" className="text-lg font-extrabold uppercase tracking-tight">2. Paste Job Description</Label>
            <Textarea
              id="job"
              required
              rows={8}
              placeholder="Paste the full job post details here..."
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              className="bg-white border-2 border-black text-black"
            />
          </div>

          {/* Keywords & Instructions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="keywords" className="font-bold">Focus Keywords (optional, comma separated)</Label>
              <Input
                id="keywords"
                placeholder="Python, AWS, Next.js"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                className="bg-white border-2 border-black text-black"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="instructions" className="font-bold">Custom Instructions (optional)</Label>
              <Input
                id="instructions"
                placeholder="e.g. emphasize my backend capabilities"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                className="bg-white border-2 border-black text-black"
              />
            </div>
          </div>

          <Button type="submit" size="lg" className="w-full">
            Start Generation Pipeline
          </Button>
        </form>
      )}

      {step === "generating" && (
        <div className="space-y-8 py-10 flex flex-col items-center">
          {/* Custom Pixel Animation */}
          <div className="flex gap-3 mb-6">
            <span className="w-6 h-6 bg-[#ff4e26] border-3 border-black pixel-bounce-1" />
            <span className="w-6 h-6 bg-yellow-400 border-3 border-black pixel-bounce-2" />
            <span className="w-6 h-6 bg-[#ff4e26] border-3 border-black pixel-bounce-3" />
          </div>

          <div className="text-center space-y-3 max-w-md w-full">
            <h3 className="font-extrabold text-xl uppercase tracking-wider">Tailoring Resume...</h3>
            <p className="text-sm font-bold text-zinc-700 bg-yellow-200 border-2 border-black px-4 py-2 shadow-[2px_2px_0px_#000000]">
              {progress.text}
            </p>
          </div>

          {/* 8-bit Progress Bar */}
          <div className="w-full max-w-lg mt-6">
            <div className="pixel-progress-bar">
              <div
                className="pixel-progress-fill"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="flex justify-between items-center text-xs font-bold mt-2">
              <span>INITIALIZING</span>
              <span>COMPILING</span>
              <span>COMPLETE</span>
            </div>
          </div>
        </div>
      )}

      {step === "result" && (
        <div className="space-y-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-6 border-3 border-black shadow-[4px_4px_0px_#000000] gap-4">
            <div className="flex gap-4 items-start">
              {pipelineStatus === "failed" ? (
                <AlertCircle className="text-red-500 shrink-0 w-8 h-8" />
              ) : (
                <CheckCircle2 className="text-[#ff4e26] shrink-0 w-8 h-8" />
              )}
              <div>
                <h3 className="font-extrabold text-lg uppercase tracking-tight">
                  {pipelineStatus === "failed" ? "Pipeline Failed" : "Resume Tailored Successfully!"}
                </h3>
                <p className="text-sm text-zinc-700 mt-1 font-medium">
                  {pipelineStatus === "failed"
                    ? "An error occurred during the generation. Please try again."
                    : "Your resume has been adapted to match the job criteria."}
                </p>
              </div>
            </div>
            <div className="flex gap-3 w-full md:w-auto">
              {pipelineStatus === "completed" && (
                <Button onClick={handleDownload} className="w-full md:w-auto">
                  <Download size={16} /> Open/Download PDF
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => setStep("input")}
                className="w-full md:w-auto bg-transparent text-black"
              >
                <ArrowLeft size={16} /> Start Over
              </Button>
            </div>
          </div>

          {/* PDF Preview Container */}
          {generationId && pipelineStatus === "completed" && (
            <div className="border-3 border-black bg-white shadow-[6px_6px_0px_#000000] h-[650px] relative">
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
