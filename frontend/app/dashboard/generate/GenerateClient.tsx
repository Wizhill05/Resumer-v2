"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { posthog, ANALYTICS_ENABLED, generationAnalyticsContext } from "@/lib/posthog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { AlertCircle, AlertTriangle, FileText, FolderGit2, Briefcase, Loader2, SlidersHorizontal, ChevronDown, ChevronUp, Download, Pencil, RotateCcw, Plus, Minus, Info, Eye } from "lucide-react"
import Link from "next/link"
import { ReportIssueButton } from "@/components/support/ReportIssueButton"
import { CreativityModeSelector, type CreativityMode } from "@/components/generation/CreativityModeSelector"
import {
  type TemplateItem,
  type TemplateLayoutResponse,
  fetchTemplateLayout,
  fetchTemplates,
  SECTION_METADATA,
} from "@/lib/template-layout"
import { TemplateLayoutEditor } from "@/components/generation/TemplateLayoutEditor"
import { TemplatePreviewDialog } from "@/components/generation/TemplatePreviewDialog"
import { MobileGenerationBrief } from "@/components/generation/MobileGenerationBrief"

type Step = "input" | "submitted"

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
  assembly: "Assembling résumé",
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
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("personal-classic")
  const [jobDescription, setJobDescription] = useState("")
  const [keywords, setKeywords] = useState("")
  const [instructions, setInstructions] = useState("")
  const [creativityMode, setCreativityMode] = useState<CreativityMode>("proper")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [splitOverride, setSplitOverride] = useState<{ projects: number; experience: number } | null>(null)
  const [adjustmentNotice, setAdjustmentNotice] = useState<string | null>(null)
  const [advancedExpanded, setAdvancedExpanded] = useState(false)
  const [createdRunId, setCreatedRunId] = useState<string | null>(null)
  const [livePercent, setLivePercent] = useState(10)
  const [liveStepLabel, setLiveStepLabel] = useState("Starting")
  const [isGenerationComplete, setIsGenerationComplete] = useState(false)
  const [isLayoutEditorOpen, setIsLayoutEditorOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<TemplateItem | null>(null)
  const [previewTemplate, setPreviewTemplate] = useState<TemplateItem | null>(null)

  const {
    data: templates = [],
    isLoading: isLoadingTemplates,
    isError: isTemplatesError,
    error: templatesError,
    refetch: refetchTemplates,
  } = useQuery<TemplateItem[]>({
    queryKey: ["templates"],
    queryFn: ({ signal }) => fetchTemplates(signal),
  })

  // Derive effective selection idiomatically without calling setState in an effect
  const selectedTemplate = useMemo(() => {
    if (templates.length === 0) return selectedTemplateId
    if (templates.some((t) => t.id === selectedTemplateId)) {
      return selectedTemplateId
    }
    return templates[0].id
  }, [templates, selectedTemplateId])

  const setSelectedTemplate = useCallback((id: string) => {
    setSelectedTemplateId(id)
  }, [])

  // Saved layout preference query per selected template
  const {
    data: layoutData,
    isLoading: isLoadingLayout,
    isError: isLayoutError,
    refetch: refetchLayout,
  } = useQuery({
    queryKey: ["template-layout", selectedTemplate],
    queryFn: ({ signal }) => fetchTemplateLayout(selectedTemplate, signal),
    enabled: !!selectedTemplate,
    staleTime: 1000 * 60 * 5,
  })

  const selectedTemplateObj = useMemo(
    () => templates.find((t) => t.id === selectedTemplate),
    [templates, selectedTemplate]
  )

  // Ensure layoutData matches the current selectedTemplate to prevent race conditions or stale updates
  const verifiedLayoutOrder = useMemo(() => {
    if (layoutData && layoutData.template_id === selectedTemplate) {
      return layoutData.section_order
    }
    return undefined
  }, [layoutData, selectedTemplate])

  // Order to send in generation POST body:
  // Sent if layout data is safely loaded and verified for selectedTemplate.
  // When loading or failed, omit order (undefined) so backend resolves stored DB preference without clobbering.
  const sectionOrderToSend = useMemo(() => {
    if (verifiedLayoutOrder) return verifiedLayoutOrder
    return undefined
  }, [verifiedLayoutOrder])

  // Display order for UI preview / summary (fallback to template default only when not loading)
  const displaySectionOrder = useMemo(() => {
    return (
      verifiedLayoutOrder ??
      (isLoadingLayout ? null : selectedTemplateObj?.default_section_order ?? null)
    )
  }, [verifiedLayoutOrder, isLoadingLayout, selectedTemplateObj])

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

  // Load the user's stored generation defaults (mode + content counts) once.
  useEffect(() => {
    fetch("/api/backend/profile/defaults")
      .then(async (res) => {
        if (!res.ok) return
        const data = await res.json()
        if (data.creativity_mode === "proper" || data.creativity_mode === "larp" || data.creativity_mode === "super_larp") {
          setCreativityMode(data.creativity_mode)
        }
        if (typeof data.preferred_projects === "number" && typeof data.preferred_experience === "number") {
          setSplitOverride({ projects: data.preferred_projects, experience: data.preferred_experience })
        }
      })
      .catch(() => {})
  }, [])

  const activeTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplate) ?? null,
    [templates, selectedTemplate]
  )

  // The backend personalizes default_content_split from the user's stored
  // preference; derive the counters during render so their choice survives
  // template refetches while any manual adjustment takes precedence.
  const baseTemplate = activeTemplate ?? templates[0]
  const projectsCount = splitOverride?.projects ?? baseTemplate?.default_content_split?.projects ?? 2
  const experienceCount = splitOverride?.experience ?? baseTemplate?.default_content_split?.experience ?? 2

  const numProfileProjects = profileProjects.length
  const numProfileExperiences = profileExperiences.length
  const hasEnoughProjects = numProfileProjects >= projectsCount
  const hasEnoughExperiences = numProfileExperiences >= experienceCount
  const isMissingMaterial = !hasEnoughProjects || !hasEnoughExperiences

  const handleProjectsChange = (delta: number) => {
    const target = projectsCount + delta
    if (target < 1 || target > 3) return

    if (target === 1) {
      setSplitOverride({ projects: 1, experience: 3 })
      setAdjustmentNotice("1 project requires min. 3 experiences for 1-page ATS layout")
      return
    } else if (target === 2) {
      if (experienceCount === 1) {
        setSplitOverride({ projects: 2, experience: 2 })
        setAdjustmentNotice("Shifted experience to 2 (1 experience requires 3 projects)")
        return
      }
    }
    setSplitOverride({ projects: target, experience: experienceCount })
    setAdjustmentNotice(null)
  }

  const handleExperienceChange = (delta: number) => {
    const target = experienceCount + delta
    if (target < 1 || target > 3) return

    if (target === 1) {
      setSplitOverride({ projects: 3, experience: 1 })
      setAdjustmentNotice("1 experience requires min. 3 projects for 1-page ATS layout")
      return
    } else if (target === 2) {
      if (projectsCount === 1) {
        setSplitOverride({ projects: 2, experience: 2 })
        setAdjustmentNotice("Shifted projects to 2 (1 project requires 3 experiences)")
        return
      }
    }
    setSplitOverride({ projects: projectsCount, experience: target })
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

    if (ANALYTICS_ENABLED) posthog.capture("resume_generation_requested", {
      is_guest: false,
      template_id: selectedTemplate,
      projects_count: projectsCount,
      experience_count: experienceCount,
      has_custom_instructions: !!instructions,
      send_email: sendEmail,
      section_order: sectionOrderToSend ?? null,
    })

    try {
      const response = await fetch("/api/backend/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: selectedTemplate,
          analytics_context: generationAnalyticsContext(),
          job_description: jobDescription,
          keywords: keywords ? keywords.split(",").map((k) => k.trim()) : [],
          instructions: instructions || null,
          content_split: { projects: projectsCount, experience: experienceCount },
          creativity_mode: creativityMode,
          send_email: sendEmail,
          section_order: sectionOrderToSend,
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
            setLiveStepLabel(log.message === "completed" ? "Résumé complete" : "Generation failed")
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
          setLiveStepLabel(data.status === "completed" ? "Résumé complete" : "Generation failed")
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
  }, [step, createdRunId, isGenerationComplete, queryClient, selectedTemplate])

  const pageHeader = (
    <div className="page-header space-y-0.5 max-md:border-l-0 max-md:p-0">
      <h1 className="text-xl font-extrabold uppercase tracking-tight md:text-2xl">Generate Résumé</h1>
      <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 md:text-sm">
        <span className="md:hidden">{step === "input" ? "Start with the job. Your saved defaults are ready." : "Target any job description in seconds."}</span>
        <span className="hidden md:inline">Target any job description in seconds.</span>
      </p>
    </div>
  )

  if (isLoadingTemplates) {
    return (
      <>
      {pageHeader}
      <div className="panel flex justify-center py-12">
        <div className="flex gap-2">
          <span className="loading-dot bg-[#ff4e26]" />
          <span className="loading-dot bg-yellow-400" />
          <span className="loading-dot bg-[#ff4e26]" />
        </div>
      </div>
      </>
    )
  }

  // Initial load failure: block screen with retry when no cached templates exist
  if (isTemplatesError && templates.length === 0) {
    return (
      <>
      {pageHeader}
      <div className="panel border-amber-200 bg-amber-50 p-6 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertCircle size={20} className="shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <div>
              <h3 className="text-sm font-bold">Failed to load templates</h3>
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                {templatesError instanceof Error ? templatesError.message : "Could not retrieve available templates."}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refetchTemplates()}
            className="shrink-0 border-amber-300 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-100 dark:hover:bg-amber-900"
          >
            Retry
          </Button>
        </div>
      </div>
      </>
    )
  }

  return (
    <div className="space-y-4 md:space-y-5 pixel-enter">
      {pageHeader}
      {/* Background template query error with cached data: retain screen & unsaved state, show retry notice */}
      {isTemplatesError && templates.length > 0 && (
        <div role="alert" className="panel flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <div className="flex items-center gap-2 text-xs">
            <AlertCircle size={16} className="shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <span>
              Failed to refresh templates in background ({templatesError instanceof Error ? templatesError.message : "network error"}). Working with cached templates.
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refetchTemplates()}
            className="shrink-0 h-8 border-amber-300 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-100 dark:hover:bg-amber-900"
          >
            Retry
          </Button>
        </div>
      )}

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
        <>
        <MobileGenerationBrief
          templates={templates}
          preferences={{ templateId: selectedTemplate, split: { projects: projectsCount, experience: experienceCount }, mode: creativityMode, keywords, instructions, sendEmail }}
          onPreferencesChange={(value) => {
            setSelectedTemplate(value.templateId)
            setSplitOverride(value.split)
            setCreativityMode(value.mode)
            setKeywords(value.keywords)
            setInstructions(value.instructions)
            setSendEmail(value.sendEmail)
          }}
          jobDescription={jobDescription}
          onJobDescriptionChange={setJobDescription}
          onGenerate={handleGenerate}
          isSubmitting={isSubmitting}
          profileProjects={numProfileProjects}
          profileExperiences={numProfileExperiences}
          sectionOrder={sectionOrderToSend}
        />
        <form onSubmit={handleGenerate} className="hidden space-y-4 pixel-enter md:block">
          {/* 1. Template Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-extrabold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">1. Select Template</Label>
              <span className="text-[11px] font-mono text-zinc-400">ATS Optimized</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {templates.map((tpl) => {
                const selected = selectedTemplate === tpl.id
                return (
                  <div
                    key={tpl.id}
                    className={`flex flex-col justify-between overflow-hidden rounded-lg border transition-colors ${
                      selected
                        ? "border-[#ff4e26] bg-white shadow-sm dark:bg-zinc-900"
                        : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedTemplate(tpl.id)}
                      aria-pressed={selected}
                      className="flex w-full items-start gap-3 p-4 text-left focus-visible:outline-2 focus-visible:outline-[#ff4e26]"
                    >
                      <FileText
                        size={22}
                        className={`mt-0.5 shrink-0 ${selected ? "text-[#ff4e26]" : "text-zinc-400"}`}
                        aria-hidden="true"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {tpl.name}
                          </span>
                        </div>
                        {tpl.description ? (
                          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                            {tpl.description}
                          </p>
                        ) : null}
                      </div>
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                          selected
                            ? "border-[#ff4e26]"
                            : "border-zinc-300 dark:border-zinc-600"
                        }`}
                      >
                        {selected && <span className="h-2 w-2 rounded-full bg-[#ff4e26]" />}
                      </span>
                    </button>
                    <div className="flex items-center gap-5 px-4 pb-3 pt-1 border-t border-zinc-100 dark:border-zinc-800/60 mt-auto">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTemplate(tpl)
                          setIsLayoutEditorOpen(true)
                        }}
                        aria-label={`Edit ${tpl.name} layout`}
                        className="inline-flex min-h-11 items-center gap-2 px-1 text-sm font-medium text-zinc-700 hover:text-[#ff4e26] dark:text-zinc-300 focus-visible:outline-2 focus-visible:outline-[#ff4e26]"
                      >
                        <Pencil size={16} aria-hidden="true" />
                        <span>Edit template</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewTemplate(tpl)}
                        aria-label={`Preview ${tpl.name}`}
                        className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-zinc-700 hover:text-[#ff4e26] dark:text-zinc-300 focus-visible:outline-2 focus-visible:outline-[#ff4e26]"
                      >
                        <Eye size={17} aria-hidden="true" />
                        <span>Preview</span>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              {isLoadingLayout && !verifiedLayoutOrder ? (
                <div className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-400 dark:text-zinc-500">
                  <Loader2 size={12} className="animate-spin text-[#ff4e26]" aria-hidden="true" />
                  <span>Loading layout preference...</span>
                </div>
              ) : isLayoutError && !verifiedLayoutOrder ? (
                <div className="flex items-center gap-2 text-[11px] text-amber-700 dark:text-amber-400">
                  <div className="flex items-center gap-1">
                    <AlertCircle size={12} className="shrink-0 text-amber-600" aria-hidden="true" />
                    <span>Layout preference unavailable</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => refetchLayout()}
                    className="font-semibold underline hover:no-underline cursor-pointer text-amber-800 dark:text-amber-300"
                    title="Retry loading template layout"
                  >
                    Retry
                  </button>
                </div>
              ) : displaySectionOrder ? (
                <div className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
                  <span className="text-zinc-400 dark:text-zinc-500">Order:</span>
                  <span className="truncate max-w-[220px] sm:max-w-xs font-sans">
                    {displaySectionOrder.map((id) => SECTION_METADATA[id]?.label || id).join(" → ")}
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          {/* 2. Job Description */}
          <div className="space-y-2">
            <Label htmlFor="jobDescription" className="text-xs font-extrabold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
              2. Job Description <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="jobDescription"
              required
              rows={6}
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Paste full job description..."
              className="font-mono text-xs"
            />
          </div>

          {/* 3. Creativity Mode */}
          <CreativityModeSelector
            value={creativityMode}
            onChange={(mode) => setCreativityMode(mode)}
          />

          {/* Advanced Options Accordion */}
          <div className="border border-zinc-200 dark:border-zinc-800 rounded-md overflow-hidden bg-white dark:bg-zinc-900">
            <button
              type="button"
              onClick={() => setAdvancedExpanded((prev) => !prev)}
              aria-expanded={advancedExpanded}
              aria-controls="generation-advanced-options"
              className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <SlidersHorizontal size={14} className="text-[#ff4e26]" />
                <span>Advanced Tailoring Controls</span>
              </div>
              {advancedExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {advancedExpanded && (
              <div id="generation-advanced-options" className="p-4 border-t border-zinc-200 dark:border-zinc-800 space-y-4 bg-zinc-50/50 dark:bg-zinc-950/50">
                {/* Content Distribution (Split) Override */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                        Content Slot Distribution
                      </Label>
                      <p className="text-[11px] text-zinc-500">
                        Total items targeted for the 1-page layout. Minimum 1 per category.
                      </p>
                    </div>
                    {splitOverride && (
                      <button
                        type="button"
                        onClick={() => {
                          setSplitOverride(null)
                          setAdjustmentNotice(null)
                        }}
                        className="inline-flex items-center gap-1 text-[11px] text-[#ff4e26] hover:underline"
                      >
                        <RotateCcw size={12} />
                        Reset
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="flex items-center justify-between p-2.5 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                      <div className="flex items-center gap-2">
                        <FolderGit2 size={16} className="text-zinc-500" />
                        <div>
                          <p className="text-xs font-semibold">Projects</p>
                          <p className="text-[10px] text-zinc-400">1 – 3</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleProjectsChange(-1)}
                          disabled={projectsCount <= 1}
                          className="w-7 h-7 flex items-center justify-center rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed text-xs font-bold"
                          aria-label="Decrease projects"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="w-5 text-center text-xs font-mono font-bold">{projectsCount}</span>
                        <button
                          type="button"
                          onClick={() => handleProjectsChange(1)}
                          disabled={projectsCount >= 3}
                          className="w-7 h-7 flex items-center justify-center rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed text-xs font-bold"
                          aria-label="Increase projects"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-2.5 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                      <div className="flex items-center gap-2">
                        <Briefcase size={16} className="text-zinc-500" />
                        <div>
                          <p className="text-xs font-semibold">Experience</p>
                          <p className="text-[10px] text-zinc-400">1 – 3</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleExperienceChange(-1)}
                          disabled={experienceCount <= 1}
                          className="w-7 h-7 flex items-center justify-center rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed text-xs font-bold"
                          aria-label="Decrease experience"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="w-5 text-center text-xs font-mono font-bold">{experienceCount}</span>
                        <button
                          type="button"
                          onClick={() => handleExperienceChange(1)}
                          disabled={experienceCount >= 3}
                          className="w-7 h-7 flex items-center justify-center rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed text-xs font-bold"
                          aria-label="Increase experience"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {adjustmentNotice && (
                    <div className="flex items-start gap-1.5 p-2 rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-[11px]">
                      <Info size={13} className="shrink-0 mt-0.5" />
                      <span>{adjustmentNotice}</span>
                    </div>
                  )}
                </div>

                {/* Keywords & Instructions */}
                <div className="space-y-3 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                  <div className="space-y-1">
                    <Label htmlFor="keywords" className="text-xs font-semibold">
                      Target Keywords (comma-separated)
                    </Label>
                    <Input
                      id="keywords"
                      value={keywords}
                      onChange={(e) => setKeywords(e.target.value)}
                      placeholder="e.g. Next.js, Kubernetes, Distributed Systems"
                      className="text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="instructions" className="text-xs font-semibold">
                      Custom Pipeline Instructions
                    </Label>
                    <Textarea
                      id="instructions"
                      rows={2}
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      placeholder="e.g. Focus on technical contributions rather than team leadership"
                      className="text-xs font-mono"
                    />
                  </div>
                </div>

                {/* Email toggle */}
                <div className="space-y-1.5 pt-2 border-t border-zinc-200 dark:border-zinc-800">
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
                        aria-pressed={sendEmail === opt.val}
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

          {/* Missing Material Warning Banner */}
          {isMissingMaterial && (
            <div className="flex items-start gap-2.5 p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200 text-xs">
              <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <div className="flex-1">
                <span className="font-semibold">Profile material is below requested split.</span>{" "}
                You requested {projectsCount} projects and {experienceCount} experiences, but your profile currently has {numProfileProjects} and {numProfileExperiences}.{" "}
                <Link href="/profile" className="underline font-bold hover:text-amber-700 dark:hover:text-amber-100">
                  Update your profile
                </Link>{" "}
                to avoid generation failure.
              </div>
            </div>
          )}

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={isSubmitting || !jobDescription.trim()}
            className="w-full bg-[#ff4e26] hover:bg-[#e0431f] text-white py-6 text-sm font-extrabold uppercase tracking-wider shadow-md hover:shadow-lg transition-all"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <Loader2 size={16} className="animate-spin" />
                Initializing Pipeline...
              </span>
            ) : (
              "Generate Tailored Résumé"
            )}
          </Button>
        </form>
        </>
      )}

      {/* Waiting Screen with Live Animated Progress Bar */}
      {step === "submitted" && (
        <div className="mx-auto max-w-xl space-y-5 py-6 md:py-8 pixel-enter">
          <div className="border border-zinc-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900 md:p-7">
            <div className="mb-4 text-center">
              <p className="text-xs font-extrabold uppercase tracking-widest text-[#ff4e26]">
                {isGenerationComplete ? liveStepLabel === "Generation failed" ? "Failed" : "Complete" : "Processing"}
              </p>
              <h3 className="text-xl font-extrabold uppercase tracking-tight text-black dark:text-white md:text-2xl">
                {isGenerationComplete ? liveStepLabel === "Generation failed" ? "Generation failed" : "Your Résumé is Ready" : "Tailoring Your Résumé"}
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


      {/* Insufficient Profile Material Modal */}
      {showErrorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="panel max-w-md w-full bg-white dark:bg-zinc-900 border-red-200 dark:border-red-900 p-6 space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <AlertCircle size={24} />
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                Insufficient Profile Data
              </h3>
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Your requested split targets <span className="font-bold text-zinc-900 dark:text-zinc-100">{projectsCount} projects</span> and <span className="font-bold text-zinc-900 dark:text-zinc-100">{experienceCount} experiences</span>, but your profile does not have enough entries to satisfy this layout.
            </p>

            <div className="space-y-1 text-xs font-mono bg-zinc-100 dark:bg-zinc-800 p-3 rounded">
              <div className="flex justify-between">
                <span>Projects:</span>
                <span>{profileProjects.length} available / {projectsCount} needed</span>
              </div>
              <div className="flex justify-between">
                <span>Experiences:</span>
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

      {previewTemplate && (
        <TemplatePreviewDialog
          templateId={previewTemplate.id}
          templateName={previewTemplate.name}
          expectedSections={previewTemplate.default_section_order}
          sectionOrder={
            previewTemplate.id === selectedTemplate
              ? sectionOrderToSend
              : queryClient.getQueryData<TemplateLayoutResponse>(["template-layout", previewTemplate.id])?.section_order
          }
          onClose={() => setPreviewTemplate(null)}
        />
      )}

      {/* Full-screen Template Layout Editor Dialog */}
      {editingTemplate && (
        <TemplateLayoutEditor
          key={editingTemplate.id}
          isOpen={isLayoutEditorOpen}
          onClose={() => {
            setIsLayoutEditorOpen(false)
            setEditingTemplate(null)
          }}
          templateId={editingTemplate.id}
          templateName={editingTemplate.name}
          defaultOrder={editingTemplate.default_section_order}
          initialAppliedOrder={
            queryClient.getQueryData<TemplateLayoutResponse>(["template-layout", editingTemplate.id])?.section_order ??
            (editingTemplate.id === selectedTemplate && layoutData?.template_id === selectedTemplate
              ? layoutData.section_order
              : undefined)
          }
          onSaved={async (newOrder, savedResponse) => {
            // Cancel pending GET query to protect against stale in-flight responses
            await queryClient.cancelQueries({ queryKey: ["template-layout", editingTemplate.id] })
            // Populate query cache with verified actual save response
            if (savedResponse) {
              queryClient.setQueryData(["template-layout", editingTemplate.id], savedResponse)
            }
            queryClient.invalidateQueries({ queryKey: ["template-preview", editingTemplate.id] })
          }}
        />
      )}
    </div>
  )
}
