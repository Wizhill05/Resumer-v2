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
      {/* Sidebar Navigation - horizontal scroll on mobile, vertical stack on desktop */}
      <div className="flex flex-row md:flex-col gap-2 overflow-x-auto md:overflow-x-visible pb-3 md:pb-0 scrollbar-none shrink-0 w-full">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeSection === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSection(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 rounded-full text-xs font-bold uppercase tracking-wider text-left transition-all shrink-0 cursor-pointer select-none border border-zinc-200/80 ${
                isActive
                  ? "bg-[#ff4e26] text-white border-[#ff4e26] shadow-sm shadow-orange-500/10"
                  : "bg-white text-zinc-600 hover:text-black hover:border-zinc-300"
              }`}
            >
              <Icon size={14} />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* Form Content Area */}
      <div className="md:col-span-3 bg-white border border-zinc-100 rounded-3xl p-6 md:p-8 shadow-sm">
        {activeSection === "basic" && <BasicInfoForm />}
        {activeSection === "experience" && <ExperienceForm />}
        {activeSection === "projects" && <ProjectForm />}
        {activeSection === "education" && <EducationForm />}
        {activeSection === "extracurricular" && <ExtracurricularForm />}
      </div>
    </div>
  )
}
