"use client"

import { useState } from "react"
import { BasicInfoForm } from "@/components/profile/BasicInfoForm"
import { ExperienceForm } from "@/components/profile/ExperienceForm"
import { ProjectForm } from "@/components/profile/ProjectForm"
import { EducationForm } from "@/components/profile/EducationForm"
import { ExtracurricularForm } from "@/components/profile/ExtracurricularForm"
import { User, Briefcase, FolderGit2, GraduationCap, Award } from "lucide-react"

type Section = "basic" | "experience" | "projects" | "education" | "extracurricular"

export function ProfileClient() {
  const [activeSection, setActiveSection] = useState<Section>("basic")

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
          const shortLabel = tab.id === "basic" ? "Info" : tab.id === "extracurricular" ? "More" : tab.label
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSection(tab.id)}
              className={`flex shrink-0 select-none items-center gap-2 border px-3 py-2 text-left text-xs font-extrabold uppercase tracking-wide transition-colors md:text-sm ${
                activeSection === tab.id
                  ? "border-zinc-950 bg-zinc-950 text-white"
                  : "border-zinc-200 bg-white text-black hover:border-zinc-500"
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
        {activeSection === "basic" && <BasicInfoForm />}
        {activeSection === "experience" && <ExperienceForm />}
        {activeSection === "projects" && <ProjectForm />}
        {activeSection === "education" && <EducationForm />}
        {activeSection === "extracurricular" && <ExtracurricularForm />}
      </div>
    </div>
  )
}
