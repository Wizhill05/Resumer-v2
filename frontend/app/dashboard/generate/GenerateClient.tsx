"use client"

import { useState, useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { AlertCircle, CheckCircle2, FileText, FolderGit2, Briefcase, Loader2, Lock } from "lucide-react"
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
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || "Failed to start generation")
      }

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
        <form onSubmit={handleGenerate} className="space-y-4 md:space-y-5">
          <section className="panel p-4 md:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <Label className="text-sm font-extrabold uppercase tracking-wider">Template</Label>
                <p className="mt-1 text-xs font-medium text-zinc-500">Controls resume structure and rendering.</p>
              </div>
              <span className="text-xs font-extrabold uppercase tracking-widest text-zinc-400">1</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {templates.map((tpl) => {
                const selected = selectedTemplate === tpl.id
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => setSelectedTemplate(tpl.id)}
                    className={`flex items-start gap-3 border p-3 text-left transition-colors ${
                      selected ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white hover:border-zinc-500"
                    }`}
                  >
                    <FileText className="mt-0.5 shrink-0" size={18} />
                    <span>
                      <span className="block text-sm font-extrabold uppercase tracking-wide">{tpl.name}</span>
                      <span className={`mt-0.5 block text-xs font-medium leading-relaxed ${selected ? "text-white/75" : "text-zinc-500"}`}>
                        {tpl.description}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          {activeTemplate && splits.length > 1 && (
            <section className="panel p-4 md:p-5">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <Label className="text-sm font-extrabold uppercase tracking-wider">Content Focus</Label>
                  <p className="mt-1 text-xs font-medium leading-relaxed text-zinc-500">
                    Choose how many saved projects and experience entries the resume should prioritize.
                  </p>
                </div>
                <span className="text-xs font-extrabold uppercase tracking-widest text-zinc-400">2</span>
              </div>

              <div className="mb-3 grid grid-cols-2 gap-2 text-xs font-bold text-zinc-600 sm:w-max">
                <span className="inline-flex items-center gap-1 border border-zinc-200 bg-zinc-50 px-2 py-1">
                  <FolderGit2 size={13} /> Your projects: {profileProjects.length}
                </span>
                <span className="inline-flex items-center gap-1 border border-zinc-200 bg-zinc-50 px-2 py-1">
                  <Briefcase size={13} /> Your experience: {profileExperiences.length}
                </span>
              </div>

              <div className="grid gap-2">
                {sliderOptions.map((opt, idx) => {
                  const selected = selectedFocusIndex === idx
                  return (
                    <button
                      key={opt.name}
                      type="button"
                      disabled={!opt.enabled}
                      onClick={() => opt.enabled && setSliderIndex(idx)}
                      className={`flex items-start justify-between gap-3 border p-3 text-left transition-colors ${
                        selected && opt.enabled
                          ? "border-zinc-950 bg-[#ff4e26]/10"
                          : opt.enabled
                            ? "border-zinc-200 bg-white hover:border-zinc-500"
                            : "border-zinc-200 bg-zinc-50 text-zinc-400"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-extrabold uppercase tracking-wide text-zinc-950">{opt.name}</span>
                          <span className="text-xs font-bold text-zinc-500">{opt.projects} projects + {opt.experience} experience</span>
                        </span>
                        <span className="mt-1 block text-xs font-medium leading-relaxed text-zinc-500">{opt.desc}</span>
                        {!opt.enabled && (
                          <span className="mt-1 flex items-center gap-1 text-xs font-bold text-red-600">
                            <Lock size={12} /> {getLockReason(opt)}
                          </span>
                        )}
                      </span>
                      {selected && opt.enabled ? <CheckCircle2 className="shrink-0 text-[#ff4e26]" size={18} /> : null}
                    </button>
                  )
                })}
              </div>

              <div className="mt-3 flex flex-col gap-2 border border-zinc-200 bg-zinc-50 p-3 text-xs font-bold text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
                <span>Selected: <span className="text-zinc-950">{activeOption?.name}</span></span>
                <span>Needs {projectsCount} projects and {experienceCount} experience entries.</span>
              </div>
            </section>
          )}

          <section className="panel p-4 md:p-5">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <Label htmlFor="job" className="text-sm font-extrabold uppercase tracking-wider">Job Description</Label>
                <p className="mt-1 text-xs font-medium text-zinc-500">Paste the full posting for better keyword matching.</p>
              </div>
              <span className="text-xs font-extrabold uppercase tracking-widest text-zinc-400">{activeTemplate && splits.length > 1 ? "3" : "2"}</span>
            </div>
            <Textarea
              id="job"
              required
              rows={6}
              placeholder="Paste job post details here..."
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              className="min-h-40"
            />
          </section>

          <section className="panel p-4 md:p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="keywords" className="font-bold">Focus Keywords</Label>
                <Input
                  id="keywords"
                  placeholder="Python, AWS, Next.js"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="instructions" className="font-bold">Custom Instructions</Label>
                <Input
                  id="instructions"
                  placeholder="Emphasize backend work"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                />
              </div>
            </div>
          </section>

          <Button type="submit" size="lg" className="w-full" disabled={isSubmitting || !jobDescription.trim()}>
            {isSubmitting ? <><Loader2 className="animate-spin" size={18} /> Starting...</> : "Generate Resume"}
          </Button>
        </form>
      )}

      {step === "submitted" && (
        <div className="mx-auto max-w-xl space-y-4 py-6 md:py-10">
          <div className="panel-strong space-y-3 p-5 text-center md:p-7">
            <h3 className="text-xl font-extrabold uppercase tracking-tight text-black">Generation Started</h3>
            <p className="text-sm font-medium leading-relaxed text-zinc-600">
              Your resume is being generated. It usually takes 5-10 minutes. Check History for progress and downloads.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link href="/dashboard/history" className="w-full sm:w-auto">
              <Button className="w-full">View History</Button>
            </Link>
            <Button
              variant="outline"
              onClick={() => {
                setJobDescription("")
                setKeywords("")
                setInstructions("")
                setStep("input")
              }}
              className="w-full sm:w-auto"
            >
              Generate Another
            </Button>
          </div>
        </div>
      )}

      {showErrorModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 md:items-center md:p-4">
          <div className="w-full max-w-md border-t border-zinc-900 bg-white p-4 shadow-2xl md:border md:p-6">
            <div className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center bg-red-50 text-red-600">
                <AlertCircle size={20} />
              </div>
              <div>
                <h3 className="text-lg font-extrabold uppercase tracking-tight">Need More Profile Material</h3>
                <p className="mt-1 text-sm font-medium leading-relaxed text-zinc-600">
                  This focus needs more saved projects or experience before generation can start.
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-2 border border-zinc-200 bg-zinc-50 p-3 text-sm font-bold">
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500">Projects</span>
                <span>{profileProjects.length} available / {projectsCount} needed</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500">Experience</span>
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
