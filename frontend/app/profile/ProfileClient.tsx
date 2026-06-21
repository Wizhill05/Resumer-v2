"use client"

import { useState } from "react"
import { BasicInfoForm } from "@/components/profile/BasicInfoForm"
import { ExperienceForm } from "@/components/profile/ExperienceForm"
import { ProjectForm } from "@/components/profile/ProjectForm"
import { EducationForm } from "@/components/profile/EducationForm"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { User, Briefcase, FolderGit2, GraduationCap } from "lucide-react"

type Section = "basic" | "experience" | "projects" | "education"

export function ProfileClient() {
  const [activeSection, setActiveSection] = useState<Section>("basic")

  const tabs = [
    { id: "basic" as Section, label: "Basic Info", icon: User },
    { id: "experience" as Section, label: "Experience", icon: Briefcase },
    { id: "projects" as Section, label: "Projects", icon: FolderGit2 },
    { id: "education" as Section, label: "Education", icon: GraduationCap },
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
      {/* Sidebar Navigation */}
      <div className="flex flex-col gap-1">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSection(tab.id)}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium text-left transition-colors ${
                activeSection === tab.id
                  ? "bg-blue-600 text-white"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
              }`}
            >
              <Icon size={18} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Form Content Area */}
      <div className="md:col-span-3 bg-zinc-900/20 border border-zinc-850 p-6 rounded-xl space-y-6">
        {activeSection === "basic" && <BasicInfoForm />}
        {activeSection === "experience" && <ExperienceForm />}
        {activeSection === "projects" && <ProjectForm />}
        {activeSection === "education" && <EducationForm />}
      </div>
    </div>
  )
}
