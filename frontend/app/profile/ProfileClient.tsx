"use client"

import { useState, useRef, useCallback, useSyncExternalStore, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { GithubNoticeBanner, useGithubReturnNotice } from "@/components/github/GithubReturnNotice"
import { BasicInfoForm } from "@/components/profile/BasicInfoForm"
import { DefaultsSection } from "@/components/profile/DefaultsSection"
import { ExperienceForm } from "@/components/profile/ExperienceForm"
import { ProjectForm } from "@/components/profile/ProjectForm"
import { EducationForm } from "@/components/profile/EducationForm"
import { ExtracurricularForm } from "@/components/profile/ExtracurricularForm"
import { ResumeImportPanel } from "@/components/profile/ResumeImportPanel"
import { UnsavedModal } from "@/components/profile/UnsavedModal"
import { ProfileChangesProvider, useProfileWork, useProfileChanges } from "@/components/profile/ProfileChanges"
import { SaveStatusBadge } from "@/components/profile/SaveStatusBadge"
import { useProfileCompleteness } from "@/components/profile/useProfileCompleteness"
import { PageHero } from "@/components/PageHero"
import { NextStepHint } from "@/components/onboarding/NextStepHint"
import { readinessMessages, useOnboardingSteps, useUpdateOnboarding } from "@/lib/onboarding"
import { User, Briefcase, FolderGit2, GraduationCap, Award, SlidersHorizontal, Upload, Check } from "lucide-react"

type Section = "basic" | "experience" | "projects" | "education" | "extracurricular"

const SECTIONS: Section[] = ["basic", "experience", "projects", "education", "extracurricular"]

const SECTION_NAMES: Record<Section, string> = {
  basic: "Basic Details",
  experience: "Work Experience",
  projects: "Projects",
  education: "Education",
  extracurricular: "Extracurriculars & Achievements",
}

// Remembers (per browser) that the user closed the "upload old résumés" card.
const INTRO_DISMISSED_KEY = "resumer_import_intro_dismissed_v1"
const introListeners = new Set<() => void>()
const introDismissedStore = {
  subscribe(listener: () => void) {
    introListeners.add(listener)
    return () => { introListeners.delete(listener) }
  },
  get: () => {
    try { return window.localStorage.getItem(INTRO_DISMISSED_KEY) === "1" } catch { return false }
  },
  dismiss() {
    try { window.localStorage.setItem(INTRO_DISMISSED_KEY, "1") } catch {}
    introListeners.forEach((listener) => listener())
  },
}

export function ProfileClient() {
  return <ProfileChangesProvider><ProfileEditor /></ProfileChangesProvider>
}

function ProfileEditor() {
  const { confirmLeave } = useProfileChanges()
  const [applyingImport, setApplyingImport] = useState(false)
  const searchParams = useSearchParams()
  const githubNotice = useGithubReturnNotice("/profile")
  // `?tab=projects` opens that tab (used as GitHub OAuth returnTo).
  const [activeSection, setActiveSection] = useState<Section>(() => {
    const tab = searchParams.get("tab")
    return SECTIONS.find((section) => section === tab) ?? "basic"
  })
  const [pendingTargetSection, setPendingTargetSection] = useState<Section | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [importVersion, setImportVersion] = useState(0)
  const [activeBusy, setActiveBusy] = useState(false)
  const [defaultsOpen, setDefaultsOpen] = useState(false)
  // New users get a full "upload old résumés" section under the hero; once the
  // profile is complete, import moves back to a compact hero button.
  const { isLoading: profileLoading, complete: profileComplete, filled, missingSections } = useProfileCompleteness()
  const onboarding = useOnboardingSteps()
  const updateOnboarding = useUpdateOnboarding()
  const introDismissed = useSyncExternalStore(introDismissedStore.subscribe, introDismissedStore.get, () => false)
  const showHeroImport = profileComplete || introDismissed

  const activeDiscardRef = useRef<(() => void) | null>(null)
  const activeSaveFnRef = useRef<(() => Promise<boolean>) | null>(null)

  const discardActiveDraft = useCallback(() => activeDiscardRef.current?.(), [])
  useProfileWork("editor", isDirty, isSaving || activeBusy, discardActiveDraft)

  const handleDirtyChange = useCallback((dirty: boolean, saveFn?: () => Promise<boolean>, busy = false, discardDraft?: () => void) => {
    activeDiscardRef.current = discardDraft || null
    setActiveBusy(busy)
    setIsDirty(dirty)
    activeSaveFnRef.current = saveFn || null
  }, [])

  const handleTabClick = async (targetSection: Section) => {
    if (targetSection === activeSection || isSaving || activeBusy || applyingImport) return
    if (!confirmLeave(["github-import"])) return

    if (!isDirty || !activeSaveFnRef.current) {
      setActiveSection(targetSection)
      setIsDirty(false)
      activeSaveFnRef.current = null
      return
    }

    setPendingTargetSection(targetSection)
  }

  const handleModalSaveAndContinue = async () => {
    if (!activeSaveFnRef.current) return
    setIsSaving(true)
    const success = await activeSaveFnRef.current()
    setIsSaving(false)
    if (success && pendingTargetSection) {
      setActiveSection(pendingTargetSection)
      setPendingTargetSection(null)
      setIsDirty(false)
      activeSaveFnRef.current = null
    }
  }

  const handleModalDiscardAndContinue = () => {
    activeDiscardRef.current?.()
    if (pendingTargetSection) {
      setActiveSection(pendingTargetSection)
      setPendingTargetSection(null)
      setIsDirty(false)
      activeSaveFnRef.current = null
    }
  }

  const handleModalCancel = () => {
    setPendingTargetSection(null)
  }

  const tabs = [
    { id: "basic" as Section, label: "Basic Info", icon: User },
    { id: "experience" as Section, label: "Experience", icon: Briefcase },
    { id: "projects" as Section, label: "Projects", icon: FolderGit2 },
    { id: "education" as Section, label: "Education", icon: GraduationCap },
    { id: "extracurricular" as Section, label: "Extracurriculars", icon: Award },
  ]

  const busy = isSaving || activeBusy

  // Getting-started nudge: which section to fill next, then the handoff to Generate.
  const filledCount = SECTIONS.filter((section) => filled[section]).length
  const nextSection = missingSections[0] as Section | undefined
  const tabLabel = (section: Section) => tabs.find((tab) => tab.id === section)?.label ?? SECTION_NAMES[section]
  let onboardingHint: ReactNode = null
  if (onboarding.active && !profileLoading) {
    if (!profileComplete && nextSection) {
      const onNext = nextSection === activeSection
      onboardingHint = (
        <NextStepHint
          eyebrow={`Profile ${filledCount} of ${SECTIONS.length}`}
          progress={{ done: filledCount, total: SECTIONS.length }}
          action={onNext ? undefined : { label: `Go to ${tabLabel(nextSection)}`, onClick: () => void handleTabClick(nextSection) }}
        >
          {onNext
            ? `Add at least one ${tabLabel(nextSection).toLowerCase().replace(/s$/, "")} entry and save. Every section needs one before you generate.`
            : `Next: ${tabLabel(nextSection)}. Every section needs at least one entry before you generate.`}
        </NextStepHint>
      )
    } else if (profileComplete && !onboarding.profileReady && onboarding.readiness) {
      // Every section has an entry, but generation's preflight still blocks
      // (missing link, too few skills, incomplete entries, or no split fits).
      const gaps = onboarding.readiness.missing
      const basicGap = gaps.some((gap) => gap.field === "professional_link" || gap.field === "skills")
      const projectGap = gaps.some((gap) => gap.field.startsWith("projects."))
      const target: Section = basicGap ? "basic" : projectGap ? "projects" : "experience"
      const messages = readinessMessages(onboarding.readiness, 3)
      onboardingHint = (
        <NextStepHint
          eyebrow="Almost ready"
          action={activeSection === target ? undefined : { label: `Go to ${tabLabel(target)}`, onClick: () => void handleTabClick(target) }}
        >
          {messages.length
            ? messages.join(" ")
            : "Add a couple more projects or roles so at least one résumé layout fits."}
        </NextStepHint>
      )
    } else if (onboarding.profileReady && onboarding.current?.id === "generate" && !onboarding.seen.includes("profile_ready")) {
      onboardingHint = (
        <NextStepHint
          eyebrow="Profile ready"
          action={{ label: "Generate résumé", href: "/dashboard/generate" }}
          onDismiss={() => updateOnboarding.mutate({ seen: ["profile_ready"] })}
        >
          Your profile has everything a résumé needs. Paste a job post and Résumer tailors it to the role.
        </NextStepHint>
      )
    }
  }
  const saveStatus = busy ? "saving" : isDirty ? "unsaved" : "saved"
  const heroButton =
    "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold transition-[background-color,border-color,opacity] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"

  return (
    <>
      <PageHero
        title="Your profile"
        subtitle="Everything Résumer draws from when it tailors a résumé."
        actions={
          <>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                aria-expanded={defaultsOpen}
                aria-controls="profile-defaults"
                onClick={() => setDefaultsOpen((open) => !open)}
                className={`${heroButton} border-line-strong bg-paper/70 text-ink backdrop-blur-sm hover:bg-paper ${defaultsOpen ? "border-ember/50" : ""}`}
              >
                <SlidersHorizontal size={16} aria-hidden="true" />
                Defaults
              </button>
              {showHeroImport && <label
                htmlFor="profile-import-input"
                aria-disabled={applyingImport}
                className={`${heroButton} border-ink bg-ink text-paper shadow-[0_8px_20px_-12px_rgb(35_10_4/60%)] hover:opacity-90 ${applyingImport ? "pointer-events-none opacity-50" : ""}`}
              >
                <Upload size={16} aria-hidden="true" />
                Import PDFs
              </label>}
            </div>
            <SaveStatusBadge
              status={saveStatus}
              onSaveNow={isDirty && !busy ? () => { void activeSaveFnRef.current?.() } : undefined}
            />
          </>
        }
      />

      <div className="page-wrap flex-1 space-y-4 md:space-y-5">
        <GithubNoticeBanner notice={githubNotice} />
        {onboardingHint}
        <DefaultsSection hideTrigger open={defaultsOpen} onOpenChange={setDefaultsOpen} />
        <ResumeImportPanel
          compact
          intro={!profileLoading && !showHeroImport}
          onDismissIntro={introDismissedStore.dismiss}
          inputId="profile-import-input"
          onApplyingChange={setApplyingImport}
          onApplied={() => { activeDiscardRef.current?.(); setImportVersion((version) => version + 1); setIsDirty(false) }}
        />

        <div className="grid grid-cols-1 gap-3 md:grid-cols-[14.5rem_minmax(0,1fr)] md:gap-8">
          {/* Mobile sticky tab strip & desktop section rail */}
          <div className="sticky top-11 z-20 -mx-3 border-b border-line bg-app/90 px-3 py-2 backdrop-blur-md md:static md:mx-0 md:self-start md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
            <p className="mb-2 hidden px-3 text-xs font-semibold text-ink-muted md:block">Sections</p>
            <div className="no-scrollbar flex gap-1.5 overflow-x-auto md:flex-col md:gap-1 md:overflow-x-visible">
              {tabs.map((tab) => {
                const Icon = tab.icon
                const shortLabel =
                  tab.id === "basic" ? "Basic" : tab.id === "extracurricular" ? "Activities" : tab.label
                const isActive = activeSection === tab.id
                return (
                  <button
                    key={tab.id}
                    aria-current={isActive ? "page" : undefined}
                    aria-controls="profile-section"
                    disabled={isSaving || activeBusy || applyingImport}
                    onClick={() => handleTabClick(tab.id)}
                    className={`relative flex shrink-0 cursor-pointer select-none items-center gap-2 rounded-md border px-3 py-1.5 text-left text-sm transition-[background-color,border-color,color,box-shadow] md:py-2.5 ${
                      isActive
                        ? "border-ember/60 bg-paper font-semibold text-ember shadow-soft md:border-line md:text-ink"
                        : "border-line font-medium text-ink/70 hover:bg-ink/5 hover:text-ink md:border-transparent"
                    }`}
                  >
                    {isActive && <span aria-hidden="true" className="absolute left-0 top-1/2 hidden h-5 w-[3px] -translate-y-1/2 rounded-full bg-ember md:block" />}
                    <Icon size={16} aria-hidden="true" className={isActive ? "text-ember" : "text-ink-faint"} />
                    <span className="md:hidden">{shortLabel}</span>
                    <span className="hidden md:inline">{tab.label}</span>
                    {onboarding.active && filled[tab.id] && (
                      <Check size={13} strokeWidth={3} aria-label="filled" className="ml-auto shrink-0 text-ok" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Main content pane */}
          <div id="profile-section" className="profile-content min-w-0" aria-label={SECTION_NAMES[activeSection]}>
            <fieldset disabled={applyingImport} className="contents">
              {activeSection === "basic" && (
                <BasicInfoForm key={importVersion} onDirtyChange={handleDirtyChange} />
              )}
              {activeSection === "experience" && (
                <ExperienceForm onDirtyChange={handleDirtyChange} />
              )}
              {activeSection === "projects" && (
                <ProjectForm onDirtyChange={handleDirtyChange} />
              )}
              {activeSection === "education" && (
                <EducationForm onDirtyChange={handleDirtyChange} />
              )}
              {activeSection === "extracurricular" && (
                <ExtracurricularForm onDirtyChange={handleDirtyChange} />
              )}
            </fieldset>
          </div>
          {pendingTargetSection && (
            <UnsavedModal
              sectionName={SECTION_NAMES[activeSection]}
              isSaving={isSaving}
              onSaveAndContinue={handleModalSaveAndContinue}
              onDiscardAndContinue={handleModalDiscardAndContinue}
              onCancel={handleModalCancel}
            />
          )}
        </div>
      </div>
    </>
  )
}
