"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { FileText, AlertCircle, Loader2 } from "lucide-react"
import Link from "next/link"

type Step = "input" | "submitted"

type TemplateItem = {
  id: string
  name: string
  description: string
}

export function GenerateClient() {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>("input")
  const [selectedTemplate, setSelectedTemplate] = useState<string>("personal-classic")
  const [jobDescription, setJobDescription] = useState("")
  const [keywords, setKeywords] = useState("")
  const [instructions, setInstructions] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

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
    if (!jobDescription.trim() || isSubmitting) return

    setError(null)
    setIsSubmitting(true)

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

      // Invalidate history so the new run appears immediately on the History page.
      queryClient.invalidateQueries({ queryKey: ["history"] })
      setStep("submitted")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSubmitting(false)
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

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={isSubmitting || !jobDescription.trim()}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="animate-spin" size={18} />
                Starting…
              </>
            ) : (
              "Start Generation Pipeline"
            )}
          </Button>
        </form>
      )}

      {step === "submitted" && (
        <div className="space-y-6 max-w-xl mx-auto py-12">
          <div className="bg-white p-8 border-3 border-black shadow-[6px_6px_0px_#000000] text-center space-y-4">
            <h3 className="font-extrabold text-2xl uppercase tracking-wider text-black">
              Generation Started!
            </h3>
            <p className="text-sm font-semibold text-zinc-700 leading-relaxed">
              Your resume is being generated. This usually takes 5–10 minutes. You&apos;ll be notified by email when it&apos;s ready — or check the History page to track progress.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/dashboard/history" className="w-full sm:w-auto">
              <Button className="w-full">
                View History
              </Button>
            </Link>
            <Button
              variant="outline"
              onClick={() => {
                setJobDescription("")
                setKeywords("")
                setInstructions("")
                setStep("input")
              }}
              className="w-full sm:w-auto bg-transparent text-black"
            >
              Generate Another
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
