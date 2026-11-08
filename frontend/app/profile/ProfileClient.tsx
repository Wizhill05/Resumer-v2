"use client"

import { useState, useRef, useCallback } from "react"
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
import { PageHero } from "@/components/PageHero"
import { User, Briefcase, FolderGit2, GraduationCap, Award, SlidersHorizontal, Upload } from "lucide-react"

type Section = "basic" | "experience" | "projects" | "education" | "extracurricular"

const SECTION_NAMES: Record<Section, string> = {
  basic: "Basic Details",
  experience: "Work Experience",
  projects: "Projects",
  education: "Education",
  extracurricular: "Extracurriculars & Achievements",
}

export function ProfileClient() {
  return <ProfileChangesProvider><ProfileEditor /></ProfileChangesProvider>
}

function ProfileEditor() {
  const { confirmLeave } = useProfileChanges()
  const [applyingImport, setApplyingImport] = useState(false)
  const [activeSection, setActiveSection] = useState<Section>("basic")
  const [pendingTargetSection, setPendingTargetSection] = useState<Section | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [importVersion, setImportVersion] = useState(0)
  const [activeBusy, setActiveBusy] = useState(false)
  const [defaultsOpen, setDefaultsOpen] = useState(false)

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
            <div className="flex flex-wrap items-center gap-2">
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
              <label
                htmlFor="profile-import-input"
                aria-disabled={applyingImport}
                className={`${heroButton} border-ink bg-ink text-paper shadow-[0_8px_20px_-12px_rgb(35_10_4/60%)] hover:opacity-90 ${applyingImport ? "pointer-events-none opacity-50" : ""}`}
              >
                <Upload size={16} aria-hidden="true" />
                Import PDFs
              </label>
            </div>
            <SaveStatusBadge
              status={saveStatus}
              onSaveNow={isDirty && !busy ? () => { void activeSaveFnRef.current?.() } : undefined}
            />
          </>
        }
      />

      <div className="page-wrap flex-1 space-y-4 md:space-y-5">
        <DefaultsSection hideTrigger open={defaultsOpen} onOpenChange={setDefaultsOpen} />
        <ResumeImportPanel
          compact
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
