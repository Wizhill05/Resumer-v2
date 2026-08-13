"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { BasicInfoForm } from "@/components/profile/BasicInfoForm"
import { ExperienceForm } from "@/components/profile/ExperienceForm"
import { ProjectForm } from "@/components/profile/ProjectForm"
import { EducationForm } from "@/components/profile/EducationForm"
import { ExtracurricularForm } from "@/components/profile/ExtracurricularForm"
import { ResumeImportPanel } from "@/components/profile/ResumeImportPanel"
import { UnsavedModal } from "@/components/profile/UnsavedModal"
import { User, Briefcase, FolderGit2, GraduationCap, Award } from "lucide-react"

type Section = "basic" | "experience" | "projects" | "education" | "extracurricular"

const SECTION_NAMES: Record<Section, string> = {
  basic: "Basic Details",
  experience: "Work Experience",
  projects: "Projects",
  education: "Education",
  extracurricular: "Extracurriculars & Achievements",
}

export function ProfileClient() {
  const [activeSection, setActiveSection] = useState<Section>("basic")
  const [pendingTargetSection, setPendingTargetSection] = useState<Section | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const activeSaveFnRef = useRef<(() => Promise<boolean>) | null>(null)

  const handleDirtyChange = useCallback((dirty: boolean, saveFn?: () => Promise<boolean>) => {
    setIsDirty(dirty)
    activeSaveFnRef.current = saveFn || null
  }, [])

  // Warn user on window close or refresh if there are unsaved edits
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault()
        e.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [isDirty])

  const handleTabClick = async (targetSection: Section) => {
    if (targetSection === activeSection) return

    if (!isDirty || !activeSaveFnRef.current) {
      setActiveSection(targetSection)
      setIsDirty(false)
      activeSaveFnRef.current = null
      return
    }

    // Try auto-saving dirty section first before switching tabs
    setIsSaving(true)
    const success = await activeSaveFnRef.current()
    setIsSaving(false)

    if (success) {
      setActiveSection(targetSection)
      setIsDirty(false)
      activeSaveFnRef.current = null
    } else {
      // Validation error or save failed -> prompt user with modal options
      setPendingTargetSection(targetSection)
    }
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

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[13rem_1fr] md:gap-5">
      <div className="flex gap-2 overflow-x-auto pb-1 md:flex-col md:overflow-x-visible md:pb-0">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const shortLabel =
            tab.id === "basic" ? "Info" : tab.id === "extracurricular" ? "More" : tab.label
          return (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              className={`flex shrink-0 select-none items-center gap-2 border px-3 py-2 text-left text-xs font-extrabold uppercase tracking-wide transition-colors md:text-sm ${
                activeSection === tab.id
                  ? "border-zinc-950 dark:border-zinc-500 bg-zinc-950 dark:bg-zinc-700 text-white"
                  : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-black dark:text-zinc-200 hover:border-zinc-500 dark:hover:border-zinc-500"
              }`}
            >
              <Icon size={16} />
              <span className="md:hidden">{shortLabel}</span>
              <span className="hidden md:inline">{tab.label}</span>
            </button>
          )
        })}
      </div>

      <div className="panel p-4 md:p-5">
        {activeSection !== "projects" && (
          <div className="mb-4">
            <ResumeImportPanel />
          </div>
        )}
        {activeSection === "basic" && (
          <BasicInfoForm onDirtyChange={handleDirtyChange} />
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
  )
}
