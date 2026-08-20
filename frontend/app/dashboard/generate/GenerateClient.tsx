"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { AlertCircle, CheckCircle2, FileText, FolderGit2, Briefcase, Loader2, Lock, SlidersHorizontal, ChevronDown, ChevronUp, Download, Pencil, RotateCcw } from "lucide-react"
import Link from "next/link"
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
  intent_parser: 15,
  section_orchestrator: 25,
  bullet_generator: 45,
  experience_tailor: 55,
  project_tailor: 65,
  education_tailor: 72,
  extracurricular_tailor: 78,
  skills_tailor: 83,
  renderer: 90,
  orphan_repair: 94,
  content_reduction: 97,
  saver: 100,
}

const nodeLabels: Record<string, string> = {
  intent_parser: "Analyzing job posting & extracting target keywords",
  section_orchestrator: "Selecting relevant source experiences and projects",
  bullet_generator: "Rewriting impact metric bullet points with AI",
  experience_tailor: "Tailoring work history to target job signals",
  project_tailor: "Optimizing technical projects & stack relevance",
  education_tailor: "Aligning coursework and education",
  extracurricular_tailor: "Formatting achievements and leadership",
  skills_tailor: "Extracting ATS-matching skill categories",
  renderer: "Rendering ATS-compliant 1-page PDF layout",
  orphan_repair: "Polishing typography and eliminating visual orphans",
  content_reduction: "Adjusting micro-spacing for strict 1-page fit",
  saver: "Finalizing and uploading high-resolution PDF",
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
  const [sliderIndex, setSliderIndex] = useState<number>(1)
  const [advancedExpanded, setAdvancedExpanded] = useState(false)
  const [createdRunId, setCreatedRunId] = useState<string | null>(null)
  const [livePercent, setLivePercent] = useState(15)
  const [liveStepLabel, setLiveStepLabel] = useState("Starting generation pipeline")
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

  const splits = activeTemplate?.allowed_content_splits ?? []

  const sliderOptions = useMemo(() => {
    return [
      {
        name: "Project Focus",
        projects: 3,
        experience: 2,
        enabled: profileProjects.length >= 3 && profileExperiences.length >= 2,
        desc: "Best when projects prove the role fit.",
      },
      {
        name: "Balanced",
        projects: 2,
        experience: 2,
        enabled: profileProjects.length >= 2 && profileExperiences.length >= 2,
        desc: "Good default for most applications.",
      },
      {
        name: "Experience Focus",
        projects: 2,
        experience: 3,
        enabled: profileProjects.length >= 2 && profileExperiences.length >= 3,
        desc: "Best when work history is strongest.",
      },
    ]
  }, [profileProjects.length, profileExperiences.length])

  const selectedFocusIndex = useMemo(() => {
    if (sliderOptions[sliderIndex]?.enabled) return sliderIndex

    const defaultSplit = activeTemplate?.default_content_split
    const defaultIdx = defaultSplit
      ? sliderOptions.findIndex(
          (opt) => opt.projects === defaultSplit.projects && opt.experience === defaultSplit.experience
        )
      : -1

    if (defaultIdx !== -1 && sliderOptions[defaultIdx]?.enabled) return defaultIdx

    const firstEnabled = sliderOptions.findIndex((opt) => opt.enabled)
    return firstEnabled !== -1 ? firstEnabled : sliderIndex
  }, [activeTemplate?.default_content_split, sliderIndex, sliderOptions])

  const activeOption = sliderOptions[selectedFocusIndex]
  const projectsCount = activeOption?.projects ?? 2
  const experienceCount = activeOption?.experience ?? 2

  const getLockReason = (opt: { projects: number; experience: number }) => {
    const missingProjects = Math.max(0, opt.projects - profileProjects.length)
    const missingExperience = Math.max(0, opt.experience - profileExperiences.length)
    const missing = []
    if (missingProjects) missing.push(`${missingProjects} more project${missingProjects === 1 ? "" : "s"}`)
    if (missingExperience) missing.push(`${missingExperience} more experience entr${missingExperience === 1 ? "y" : "ies"}`)
    return missing.length ? `Locked: add ${missing.join(" and ")} to your profile.` : "Available"
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
      setLivePercent(15)
      setLiveStepLabel("Starting generation pipeline")
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
            setLiveStepLabel(log.message === "completed" ? "Resume generation complete" : "Generation failed")
            setIsGenerationComplete(true)
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
          setLiveStepLabel(data.status === "completed" ? "Resume generation complete" : "Generation failed")
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
        <div className="panel flex items-center gap-3 border-red-200 bg-red-50 p-3 text-red-700">
          <AlertCircle className="shrink-0" size={18} />
          <p className="text-sm font-bold">{error}</p>
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

          {/* 3. Optional Collapsible Advanced Options Accordion */}
          <div className="border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/60 md:p-4">
            <button
              type="button"
              onClick={() => setAdvancedExpanded(!advancedExpanded)}
              className="flex w-full items-center justify-between text-left font-black text-xs uppercase tracking-wider text-zinc-800 dark:text-zinc-200 cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <SlidersHorizontal size={14} className="text-[#ff4e26]" />
                Customize Focus &amp; Keywords (Optional)
              </span>
              {advancedExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {advancedExpanded && (
              <div className="mt-3.5 space-y-4 border-t border-zinc-200 pt-3.5 dark:border-zinc-800">
                {/* Focus Split */}
                {activeTemplate && splits.length > 1 && (
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase text-zinc-700 dark:text-zinc-300">Content weighting</Label>
                    <div className="grid gap-2">
                      {sliderOptions.map((opt, idx) => {
                        const selected = selectedFocusIndex === idx
                        return (
                          <button
                            key={opt.name}
                            type="button"
                            disabled={!opt.enabled}
                            onClick={() => opt.enabled && setSliderIndex(idx)}
                            className={`flex items-center justify-between border p-2.5 text-left text-xs transition-colors cursor-pointer ${
                              selected && opt.enabled
                                ? "border-zinc-950 dark:border-zinc-400 bg-white dark:bg-zinc-800 font-extrabold"
                                : opt.enabled
                                ? "border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 hover:border-zinc-400"
                                : "border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800/20 text-zinc-400"
                            }`}
                          >
                            <span>
                              <span className="uppercase">{opt.name}</span>
                              <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">({opt.projects} projects, {opt.experience} experiences)</span>
                            </span>
                            {selected && opt.enabled && <CheckCircle2 size={14} className="text-[#ff4e26]" />}
                            {!opt.enabled && <span className="text-[10px] text-red-500 font-bold flex items-center gap-1"><Lock size={10} /> Locked</span>}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

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
              <p className="mt-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400 md:text-sm">
                {liveStepLabel}
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
            {/* Actions once complete */}
            {isGenerationComplete && createdRunId && (
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
