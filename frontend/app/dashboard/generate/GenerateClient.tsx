"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { posthog } from "@/lib/posthog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { AlertCircle, AlertTriangle, FileText, FolderGit2, Briefcase, Loader2, SlidersHorizontal, ChevronDown, ChevronUp, Download, Pencil, RotateCcw, Plus, Minus, Info } from "lucide-react"
import Link from "next/link"
import { ReportIssueButton } from "@/components/support/ReportIssueDialog"
type Step = "input" | "submitted"

type ContentSplit = {
  projects: number
  experience: number
  label: string
}
type TemplateItem = {
  id: string
  name: string
  description: string
  content_slots: number
  allowed_content_splits: ContentSplit[]
  default_content_split: ContentSplit
}

type ProfileEntry = { id?: string }
const nodeProgressMap: Record<string, number> = {
  job_analysis: 10,
  selection: 18,
  summary_skills: 26,
  experience_writer: 34,
  experience: 34,
  projects_writer: 42,
  project: 42,
  extracurricular_writer: 50,
  extracurricular: 50,
  assembly: 58,
  renderer: 68,
  render: 68,
  orphan_repair: 76,
  content_reduction: 84,
  saver: 95,
  save_artifacts: 95,
}

const nodeLabels: Record<string, string> = {
  job_analysis: "Analyzing job post",
  selection: "Selecting content",
  summary_skills: "Writing summary & skills",
  experience_writer: "Writing experience",
  experience: "Writing experience",
  projects_writer: "Writing projects",
  project: "Writing projects",
  extracurricular_writer: "Writing extracurriculars",
  extracurricular: "Writing extracurriculars",
  assembly: "Assembling resume",
  renderer: "Rendering PDF",
  render: "Rendering PDF",
  orphan_repair: "Fixing layout issues",
  content_reduction: "Optimizing fit",
  saver: "Saving files",
  save_artifacts: "Saving files",
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
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [projectsCount, setProjectsCount] = useState<number>(2)
  const [experienceCount, setExperienceCount] = useState<number>(2)
  const [adjustmentNotice, setAdjustmentNotice] = useState<string | null>(null)
  const [advancedExpanded, setAdvancedExpanded] = useState(false)
  const [createdRunId, setCreatedRunId] = useState<string | null>(null)
  const [livePercent, setLivePercent] = useState(10)
  const [liveStepLabel, setLiveStepLabel] = useState("Starting")
  const [isGenerationComplete, setIsGenerationComplete] = useState(false)

  const { data: templates = [], isLoading: isLoadingTemplates } = useQuery<TemplateItem[]>({
    queryKey: ["templates"],
    queryFn: async () => {
      const res = await fetch("/api/backend/templates")
      if (!res.ok) throw new Error("Failed to load templates")
      return res.json()
    },
  })

  const { data: profileExperiences = [] } = useQuery<ProfileEntry[]>({
    queryKey: ["profile-experiences"],
    queryFn: async () => {
      const res = await fetch("/api/backend/profile/experiences")
      if (!res.ok) throw new Error("Failed to load experiences")
      return res.json()
    },
  })

  const { data: profileProjects = [] } = useQuery<ProfileEntry[]>({
    queryKey: ["profile-projects"],
    queryFn: async () => {
      const res = await fetch("/api/backend/profile/projects")
      if (!res.ok) throw new Error("Failed to load projects")
      return res.json()
    },
  })

  const { data: profileData } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const res = await fetch("/api/backend/profile")
      if (!res.ok) return null
      return res.json()
    },
  })

  const [sendEmail, setSendEmail] = useState<boolean | null>(null)

  const activeTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplate) ?? null,
    [templates, selectedTemplate]
  )

  const numProfileProjects = profileProjects.length
  const numProfileExperiences = profileExperiences.length
  const hasEnoughProjects = numProfileProjects >= projectsCount
  const hasEnoughExperiences = numProfileExperiences >= experienceCount
  const isMissingMaterial = !hasEnoughProjects || !hasEnoughExperiences

  const handleProjectsChange = (delta: number) => {
    const target = projectsCount + delta
    if (target < 1 || target > 3) return

    if (target === 1) {
      setExperienceCount(3)
      setProjectsCount(1)
      setAdjustmentNotice("1 project requires min. 3 experiences for 1-page ATS layout")
      return
    } else if (target === 2) {
      if (experienceCount === 1) {
        setExperienceCount(2)
        setProjectsCount(2)
        setAdjustmentNotice("Shifted experience to 2 (1 experience requires 3 projects)")
        return
      }
    }
    setProjectsCount(target)
    setAdjustmentNotice(null)
  }

  const handleExperienceChange = (delta: number) => {
    const target = experienceCount + delta
    if (target < 1 || target > 3) return

    if (target === 1) {
      setProjectsCount(3)
      setExperienceCount(1)
      setAdjustmentNotice("1 experience requires min. 3 projects for 1-page ATS layout")
      return
    } else if (target === 2) {
      if (projectsCount === 1) {
        setProjectsCount(2)
        setExperienceCount(2)
        setAdjustmentNotice("Shifted projects to 2 (1 project requires 3 experiences)")
        return
      }
    }
    setExperienceCount(target)
    setAdjustmentNotice(null)
  }

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!jobDescription.trim() || isSubmitting) return

    if (profileProjects.length < projectsCount || profileExperiences.length < experienceCount) {
      setShowErrorModal(true)
      return
    }

    setError(null)
    setIsSubmitting(true)

    posthog.capture("resume_generation_started", {
      template_id: selectedTemplate,
      projects_count: projectsCount,
      experience_count: experienceCount,
      has_custom_instructions: !!instructions,
      send_email: sendEmail,
    })

    try {
      const response = await fetch("/api/backend/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: selectedTemplate,
          job_description: jobDescription,
          keywords: keywords ? keywords.split(",").map((k) => k.trim()) : [],
          instructions: instructions || null,
          content_split: { projects: projectsCount, experience: experienceCount },
          send_email: sendEmail,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || "Failed to start generation")
      }
      const resData = await response.json()
      const runId = resData.id || resData.run_id || resData.generation_id
      if (runId) setCreatedRunId(runId)

      queryClient.invalidateQueries({ queryKey: ["history"] })
      setLivePercent(10)
      setLiveStepLabel("Starting")
      setIsGenerationComplete(false)
      setStep("submitted")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  // Live polling for started generation
  useEffect(() => {
    if (step !== "submitted" || !createdRunId || isGenerationComplete) return

    let active = true
    let since = 0
    const poll = async () => {
      if (!active) return
      try {
        const res = await fetch(`/api/backend/generate/${createdRunId}/logs?since=${since}`)
        if (!res.ok) return
        const data = await res.json()
        const logs = (data.logs ?? []) as Array<{ id: number; node: string | null; message: string; level: string }>
        for (const log of logs) {
          since = log.id
          if (log.level === "status" && (log.message === "completed" || log.message === "failed")) {
            setLivePercent(100)
            setLiveStepLabel(log.message === "completed" ? "Resume complete" : "Generation failed")
            setIsGenerationComplete(true)
            posthog.capture(log.message === "completed" ? "resume_generation_completed" : "resume_generation_failed", {
              run_id: createdRunId,
              template_id: selectedTemplate,
            })
            queryClient.invalidateQueries({ queryKey: ["history"] })
            return
          }
          if (log.node) {
            const p = nodeProgressMap[log.node]
            if (p) setLivePercent((prev) => Math.max(prev, p))
            const label = nodeLabels[log.node]
            if (label) setLiveStepLabel(label)
          }
        }
        if (data.status === "completed" || data.status === "failed") {
          setLivePercent(100)
          setLiveStepLabel(data.status === "completed" ? "Resume complete" : "Generation failed")
          setIsGenerationComplete(true)
          queryClient.invalidateQueries({ queryKey: ["history"] })
        }
      } catch {}
    }

    poll()
    const timer = setInterval(poll, 2500)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [step, createdRunId, isGenerationComplete, queryClient])

  if (isLoadingTemplates) {
    return (
      <div className="panel flex justify-center py-12">
        <div className="flex gap-2">
          <span className="loading-dot bg-[#ff4e26]" />
          <span className="loading-dot bg-yellow-400" />
          <span className="loading-dot bg-[#ff4e26]" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 md:space-y-5 pixel-enter">
      {error && (
        <div className="panel flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-red-200 bg-red-50 p-3 text-red-700">
          <div className="flex items-center gap-3 min-w-0">
            <AlertCircle className="shrink-0" size={18} />
            <p className="text-sm font-bold min-w-0 break-words">{error}</p>
          </div>
          <ReportIssueButton
            defaultCategory="generation"
            defaultMessage={`[Generation] Failed to start\nError: ${error}\nTemplate: ${selectedTemplate}\nContent split: ${projectsCount} projects / ${experienceCount} experiences\n\nDescribe what you expected and steps you took:\n`}
            userEmail={profileData?.email}
            title="Report generation start failure"
            description="Prefilled with your template and content split. Just add what happened before the error."
            variant="outline"
            size="sm"
            className="shrink-0 bg-white dark:bg-zinc-900 border-red-300 text-red-700 hover:bg-red-50 text-xs font-black uppercase tracking-wider h-8"
          />
        </div>
      )}

      {step === "input" && (
        <form onSubmit={handleGenerate} className="space-y-4 pixel-enter">
          {/* 1. Template Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-extrabold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">1. Select Template</Label>
              <span className="text-[11px] font-mono text-zinc-400">ATS Optimized</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {templates.map((tpl) => {
                const selected = selectedTemplate === tpl.id
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => setSelectedTemplate(tpl.id)}
                    className={`flex items-center justify-between border p-3 text-left transition-all cursor-pointer ${
                      selected
                        ? "border-zinc-950 dark:border-zinc-400 bg-zinc-950 dark:bg-zinc-800 text-white shadow-xs"
                        : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 hover:border-zinc-400"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileText size={16} className={selected ? "text-[#ff4e26]" : "text-zinc-400"} />
                      <span className="text-xs font-extrabold uppercase truncate">{tpl.name}</span>
                    </div>
                    {selected && (
                      <span className="shrink-0 text-[10px] font-mono font-bold text-[#ff4e26]">
                        [SELECTED]
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 2. Job Description Textarea (Primary Action) */}
          <div className="space-y-2">
            <Label htmlFor="job" className="text-xs font-extrabold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
              2. Target Job Description *
            </Label>
            <Textarea
              id="job"
              required
              rows={6}
              placeholder="Paste the full job posting here (responsibilities, requirements, tech stack)..."
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              className="min-h-36 font-sans text-sm leading-relaxed"
            />
          </div>

          {/* 3. Content Split (Projects & Experience Counters) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-extrabold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
                3. Content Split
              </Label>
              <span className="text-[11px] font-mono text-zinc-400">
                {projectsCount} Proj &bull; {experienceCount} Exp
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {/* Projects Counter */}
              <div className="flex items-center justify-between border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <FolderGit2 size={16} className="text-[#ff4e26] shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-extrabold uppercase truncate text-zinc-900 dark:text-zinc-100">
                      Projects
                    </span>
                    <span className="text-[10px] font-mono text-zinc-400">
                      {numProfileProjects} in profile
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={projectsCount <= 1}
                    onClick={() => handleProjectsChange(-1)}
                    className="flex h-7 w-7 items-center justify-center border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-30 disabled:pointer-events-none cursor-pointer transition-colors"
                    aria-label="Decrease projects"
                  >
                    <Minus size={13} />
                  </button>
                  <span className="w-5 text-center font-mono text-sm font-black text-zinc-900 dark:text-zinc-100">
                    {projectsCount}
                  </span>
                  <button
                    type="button"
                    disabled={projectsCount >= 3}
                    onClick={() => handleProjectsChange(1)}
                    className="flex h-7 w-7 items-center justify-center border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-30 disabled:pointer-events-none cursor-pointer transition-colors"
                    aria-label="Increase projects"
                  >
                    <Plus size={13} />
                  </button>
                </div>
              </div>

              {/* Experience Counter */}
              <div className="flex items-center justify-between border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Briefcase size={16} className="text-[#ff4e26] shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-extrabold uppercase truncate text-zinc-900 dark:text-zinc-100">
                      Experience
                    </span>
                    <span className="text-[10px] font-mono text-zinc-400">
                      {numProfileExperiences} in profile
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={experienceCount <= 1}
                    onClick={() => handleExperienceChange(-1)}
                    className="flex h-7 w-7 items-center justify-center border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-30 disabled:pointer-events-none cursor-pointer transition-colors"
                    aria-label="Decrease experience"
                  >
                    <Minus size={13} />
                  </button>
                  <span className="w-5 text-center font-mono text-sm font-black text-zinc-900 dark:text-zinc-100">
                    {experienceCount}
                  </span>
                  <button
                    type="button"
                    disabled={experienceCount >= 3}
                    onClick={() => handleExperienceChange(1)}
                    className="flex h-7 w-7 items-center justify-center border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-30 disabled:pointer-events-none cursor-pointer transition-colors"
                    aria-label="Increase experience"
                  >
                    <Plus size={13} />
                  </button>
                </div>
              </div>
            </div>

            {/* Auto-shift notice if triggered */}
            {adjustmentNotice && (
              <p className="text-[11px] font-mono text-[#ff4e26] flex items-center gap-1.5 pt-0.5">
                <Info size={12} className="shrink-0" />
                <span>{adjustmentNotice}</span>
              </p>
            )}

            {/* Missing profile material warning */}
            {isMissingMaterial && (
              <p className="text-[11px] font-mono text-amber-600 dark:text-amber-400 flex items-center justify-between gap-1 pt-0.5">
                <span className="flex items-center gap-1.5">
                  <AlertTriangle size={12} className="shrink-0" />
                  <span>
                    Need {!hasEnoughProjects ? `${projectsCount - numProfileProjects} more project(s)` : ""}
                    {!hasEnoughProjects && !hasEnoughExperiences ? " & " : ""}
                    {!hasEnoughExperiences ? `${experienceCount - numProfileExperiences} more experience(s)` : ""} in profile
                  </span>
                </span>
                <Link href="/profile" className="underline font-bold hover:text-amber-500">
                  Add &rarr;
                </Link>
              </p>
            )}
          </div>

          {/* 4. Optional Collapsible Advanced Options Accordion (Keywords, Instructions, Email) */}
          <div className="border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/60 md:p-4">
            <button
              type="button"
              onClick={() => setAdvancedExpanded(!advancedExpanded)}
              className="flex w-full items-center justify-between text-left font-black text-xs uppercase tracking-wider text-zinc-800 dark:text-zinc-200 cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <SlidersHorizontal size={14} className="text-[#ff4e26]" />
                4. Additional Customization &amp; Keywords (Optional)
              </span>
              {advancedExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {advancedExpanded && (
              <div className="mt-3.5 space-y-4 border-t border-zinc-200 pt-3.5 dark:border-zinc-800">
                {/* Keywords & Instructions */}
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="keywords" className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Focus Keywords</Label>
                    <Input
                      id="keywords"
                      placeholder="e.g. AWS, React, Python"
                      value={keywords}
                      onChange={(e) => setKeywords(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="instructions" className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Custom Instructions</Label>
                    <Input
                      id="instructions"
                      placeholder="e.g. Emphasize distributed systems"
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                    />
                  </div>
                </div>

                {/* Email toggle */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Email notification</Label>
                  <div className="grid grid-cols-3 gap-1.5 text-xs font-bold">
                    {[
                      { val: null, label: "Default" },
                      { val: true, label: "Send Email" },
                      { val: false, label: "No Email" },
                    ].map((opt) => (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() => setSendEmail(opt.val)}
                        className={`border py-1.5 text-center transition-colors cursor-pointer ${
                          sendEmail === opt.val
                            ? "border-zinc-950 dark:border-zinc-400 bg-zinc-950 dark:bg-zinc-700 text-white"
                            : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 4. Action & Discreet Beta Limit Note */}
          <div className="space-y-2 pt-2">
            <Button type="submit" size="lg" className="w-full" disabled={isSubmitting || !jobDescription.trim()}>
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin" size={18} /> Generating...
                </>
              ) : (
                "Generate Tailored Resume"
              )}
            </Button>
            <p className="text-center font-mono text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
              Free beta limit: 5 builds / day &bull; Resets in 24 hours
            </p>
          </div>
        </form>
      )}

      {/* Waiting Screen with Live Animated Progress Bar */}
      {step === "submitted" && (
        <div className="mx-auto max-w-xl space-y-5 py-6 md:py-8 pixel-enter">
          <div className="border border-zinc-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900 md:p-7">
            <div className="mb-4 text-center">
              <p className="text-xs font-extrabold uppercase tracking-widest text-[#ff4e26]">
                {isGenerationComplete ? "Complete" : "Processing"}
              </p>
              <h3 className="text-xl font-extrabold uppercase tracking-tight text-black dark:text-white md:text-2xl">
                {isGenerationComplete ? "Your Resume is Ready" : "Tailoring Your Resume"}
              </h3>
              <p className="mt-1 text-xs font-medium text-amber-500 dark:text-amber-400 md:text-sm">
                {liveStepLabel} ({livePercent}%)
              </p>
            </div>

            {/* Live Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between font-mono text-xs font-bold text-zinc-600 dark:text-zinc-400">
                <span>Progress</span>
                <span>{livePercent}%</span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
                <div
                  className="h-full bg-[#ff4e26] transition-all duration-500 ease-out"
                  style={{ width: `${livePercent}%` }}
                />
              </div>
            </div>

            {/* Safe to close & Notification note */}
            {!isGenerationComplete && (
              <p className="mt-4 text-center text-xs font-medium leading-relaxed text-zinc-500 dark:text-zinc-400">
                It is safe to close this window as this might take some time.{" "}
                {sendEmail === true || (sendEmail === null && (profileData?.notify_on_completion ?? true)) ? (
                  profileData?.email ? (
                    <>
                      You&apos;ll get an email at{" "}
                      <strong className="text-zinc-800 dark:text-zinc-200">
                        {profileData.email}
                      </strong>{" "}
                      when done.
                    </>
                  ) : (
                    <>You&apos;ll receive an email notification when done.</>
                  )
                ) : (
                  <>You can check the progress in the history page.</>
                )}
              </p>
            )}
            {/* Actions once complete or failed */}
            {isGenerationComplete && createdRunId && liveStepLabel === "Generation failed" && (
              <div className="mt-6 space-y-3 pt-4 border-t border-zinc-200 dark:border-zinc-800">
                <div className="flex items-start gap-2 border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 p-3">
                  <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-600" />
                  <p className="text-xs font-bold leading-relaxed text-red-800 dark:text-red-300">
                    Generation failed. Your input is saved — you can report this and we will check logs for run {createdRunId.slice(0, 8)}.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <ReportIssueButton
                    defaultCategory="generation"
                    defaultMessage={`[Generation failed]\nRun ID: ${createdRunId}\nStep: ${liveStepLabel}\nTemplate: ${selectedTemplate}\nContent split: ${projectsCount} projects / ${experienceCount} experiences\n\nWhat did you expect? Describe your job description length and any custom instructions:\n`}
                    generationId={createdRunId}
                    userEmail={profileData?.email}
                    title="Report failed generation"
                    description="Run ID and context are prefilled. Add a sentence about the job description and expected result."
                    variant="outline"
                    size="sm"
                    className="flex-1 font-black uppercase tracking-wider"
                  >
                    Report this failure
                  </ReportIssueButton>
                  <Link href="/support" className="flex-1">
                    <Button variant="outline" className="w-full font-bold uppercase tracking-wider text-xs">
                      Open support
                    </Button>
                  </Link>
                </div>
              </div>
            )}
            {isGenerationComplete && createdRunId && liveStepLabel !== "Generation failed" && (
              <div className="mt-6 flex flex-col gap-2.5 sm:flex-row pt-4 border-t border-zinc-200 dark:border-zinc-800">
                <a
                  href={`/api/backend/generate/${createdRunId}/download`}
                  className="flex-1"
                >
                  <Button className="w-full">
                    <Download size={16} /> Download PDF
                  </Button>
                </a>
                <Link
                  href={`/dashboard/history/${createdRunId}/edit`}
                  className="flex-1"
                >
                  <Button variant="outline" className="w-full">
                    <Pencil size={16} /> Open Editor
                  </Button>
                </Link>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row sm:justify-center">
            <Link href="/dashboard/history" className="w-full sm:w-auto">
              <Button variant="outline" className="w-full">
                View All History
              </Button>
            </Link>
            <Button
              variant="ghost"
              onClick={() => {
                setJobDescription("")
                setKeywords("")
                setInstructions("")
                setCreatedRunId(null)
                setIsGenerationComplete(false)
                setStep("input")
              }}
              className="w-full sm:w-auto"
            >
              <RotateCcw size={14} /> Generate Another
            </Button>
          </div>
        </div>
      )}

      {showErrorModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 md:items-center md:p-4">
          <div className="w-full max-w-md border-t border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 shadow-2xl md:border md:p-6">
            <div className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center bg-red-50 dark:bg-red-950/40 text-red-600">
                <AlertCircle size={20} />
              </div>
              <div>
                <h3 className="text-lg font-extrabold uppercase tracking-tight dark:text-white">Need More Profile Material</h3>
                <p className="mt-1 text-sm font-medium leading-relaxed text-zinc-600 dark:text-zinc-400">
                  This focus needs more saved projects or experience before generation can start.
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-2 border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-3 text-sm font-bold">
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500 dark:text-zinc-400">Projects</span>
                <span>{profileProjects.length} available / {projectsCount} needed</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500 dark:text-zinc-400">Experience</span>
                <span>{profileExperiences.length} available / {experienceCount} needed</span>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Link href="/profile" className="flex-1">
                <Button className="w-full">Update Profile</Button>
              </Link>
              <Button variant="outline" type="button" onClick={() => setShowErrorModal(false)} className="flex-1">
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
