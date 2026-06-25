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
    <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
      {/* Sidebar Navigation */}
      <div className="flex flex-row md:flex-col gap-2 overflow-x-auto md:overflow-x-visible pb-2 md:pb-0 scrollbar-thin">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSection(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 border-2 border-black font-extrabold text-sm uppercase tracking-wider text-left transition-all shrink-0 select-none ${
                activeSection === tab.id
                  ? "bg-[#ff4e26] text-white shadow-[2px_2px_0px_#000000]"
                  : "bg-white text-black shadow-[2px_2px_0px_#000000] hover:-translate-y-px hover:shadow-[3px_3px_0px_#000000] active:translate-x-px active:translate-y-px active:shadow-[1px_1px_0px_#000000]"
              }`}
            >
              <Icon size={16} />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* Form Content Area */}
      <div className="md:col-span-3 border-3 border-black bg-white p-6 shadow-[4px_4px_0px_#000000] space-y-6">
        {activeSection === "basic" && <BasicInfoForm />}
        {activeSection === "experience" && <ExperienceForm />}
        {activeSection === "projects" && <ProjectForm />}
        {activeSection === "education" && <EducationForm />}
        {activeSection === "extracurricular" && <ExtracurricularForm />}
      </div>
    </div>
  )
}
