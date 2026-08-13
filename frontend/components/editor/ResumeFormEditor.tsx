"use client"

import { useState } from "react"
import {
  User,
  FileText,
  Code,
  Briefcase,
  FolderGit,
  GraduationCap,
  Award,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown
} from "lucide-react"
import type { EditorProfile, TailoredResume } from "@/lib/resume-schema"

type Props = {
  resume: TailoredResume
  profile: EditorProfile
  onUpdate: (resume: TailoredResume, profile: EditorProfile) => void
}

export function ResumeFormEditor({ resume, profile, onUpdate }: Props) {
  const [expandedSection, setExpandedSection] = useState<string | null>("personal")

  function toggleSection(section: string) {
    setExpandedSection(expandedSection === section ? null : section)
  }

  // Profile (Personal details) updates
  function updateProfileField(field: keyof EditorProfile, value: string) {
    const updatedProfile = { ...profile, [field]: value }
    onUpdate(resume, updatedProfile)
  }

  // Resume (Summary) updates
  function updateSummary(value: string) {
    const updatedResume = { ...resume, summary: value }
    onUpdate(updatedResume, profile)
  }

  // Skills updates
  function updateSkillCategoryName(oldCategory: string, newCategory: string) {
    if (!newCategory.trim() || oldCategory === newCategory) return
    const skills = { ...resume.skills }
    skills[newCategory] = skills[oldCategory] || []
    delete skills[oldCategory]
    onUpdate({ ...resume, skills }, profile)
  }

  function addSkillCategory() {
    const categoryName = prompt("Enter new skill category name (e.g. Languages, Databases):")
    if (!categoryName) return
    const cleanedName = categoryName.trim()
    if (!cleanedName) return
    const skills = { ...resume.skills }
    if (skills[cleanedName]) return
    skills[cleanedName] = []
    onUpdate({ ...resume, skills }, profile)
  }

  function deleteSkillCategory(category: string) {
    if (!confirm(`Delete category "${category}" and all its skills?`)) return
    const skills = { ...resume.skills }
    delete skills[category]
    onUpdate({ ...resume, skills }, profile)
  }

  // Generic tag-based adding for skills
  function addSkillToCategory(category: string, skillInput: string) {
    if (!skillInput.trim()) return
    const skills = { ...resume.skills }
    const current = skills[category] || []
    if (current.includes(skillInput.trim())) return
    skills[category] = [...current, skillInput.trim()]
    onUpdate({ ...resume, skills }, profile)
  }

  function updateSkillInCategory(category: string, oldSkill: string, newSkill: string) {
    if (!newSkill.trim() || oldSkill === newSkill) return
    const skills = { ...resume.skills }
    const current = skills[category] || []
    const idx = current.indexOf(oldSkill)
    if (idx === -1) return
    const updated = [...current]
    updated[idx] = newSkill.trim()
    skills[category] = updated
    onUpdate({ ...resume, skills }, profile)
  }

  function deleteSkillFromCategory(category: string, skillToDelete: string) {
    const skills = { ...resume.skills }
    skills[category] = (skills[category] || []).filter((s) => s !== skillToDelete)
    onUpdate({ ...resume, skills }, profile)
  }

  // Generic item array helper for Experience, Projects, Education, Extracurriculars
  function updateArrayItemField<T>(
    key: keyof TailoredResume,
    index: number,
    field: keyof T,
    value: unknown
  ) {
    const arr = [...((resume[key] || []) as T[])]
    arr[index] = { ...arr[index], [field]: value }
    onUpdate({ ...resume, [key]: arr }, profile)
  }

  function deleteArrayItem(key: keyof TailoredResume, index: number) {
    if (!confirm(`Are you sure you want to delete this entry?`)) return
    const arr = [...((resume[key] || []) as unknown[])]
    arr.splice(index, 1)
    onUpdate({ ...resume, [key]: arr }, profile)
  }

  // Helper for adding experiences, projects, etc.
  function addArrayItem(key: keyof TailoredResume, defaultValue: unknown) {
    const arr = [...((resume[key] || []) as unknown[])]
    arr.push(defaultValue)
    onUpdate({ ...resume, [key]: arr }, profile)
  }

  function reorderArrayItem(key: keyof TailoredResume, index: number, direction: "up" | "down") {
    const arr = [...((resume[key] || []) as unknown[])]
    const targetIndex = direction === "up" ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= arr.length) return
    const temp = arr[index]
    arr[index] = arr[targetIndex]
    arr[targetIndex] = temp
    onUpdate({ ...resume, [key]: arr }, profile)
  }

  // Bullet points helpers (Experience, Projects)
  function updateBulletPoint(key: "experiences" | "projects", itemIndex: number, bulletIndex: number, text: string) {
    const items = [...((resume[key] || []) as any[])]
    const bullets = [...(items[itemIndex].bullet_points || [])]
    bullets[bulletIndex] = text
    items[itemIndex] = { ...items[itemIndex], bullet_points: bullets }
    onUpdate({ ...resume, [key]: items }, profile)
  }

  function addBulletPoint(key: "experiences" | "projects", itemIndex: number) {
    const items = [...((resume[key] || []) as any[])]
    const bullets = [...(items[itemIndex].bullet_points || [])]
    bullets.push("")
    items[itemIndex] = { ...items[itemIndex], bullet_points: bullets }
    onUpdate({ ...resume, [key]: items }, profile)
  }

  function deleteBulletPoint(key: "experiences" | "projects", itemIndex: number, bulletIndex: number) {
    const items = [...((resume[key] || []) as any[])]
    const bullets = [...(items[itemIndex].bullet_points || [])]
    bullets.splice(bulletIndex, 1)
    items[itemIndex] = { ...items[itemIndex], bullet_points: bullets }
    onUpdate({ ...resume, [key]: items }, profile)
  }

  return (
    <div className="flex-1 overflow-auto p-4 space-y-3 bg-zinc-50 dark:bg-zinc-950">
      {/* 1. PERSONAL DETAILS */}
      <Section
        title="Personal Details"
        icon={<User size={15} />}
        isExpanded={expandedSection === "personal"}
        onToggle={() => toggleSection("personal")}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>Full Name</Label>
            <Input
              value={profile.full_name || ""}
              onChange={(e) => updateProfileField("full_name", e.target.value)}
              placeholder="Aryan Singh"
            />
          </div>
          <div>
            <Label>Job Title / Subtitle</Label>
            <Input
              value={profile.subtitle || ""}
              onChange={(e) => updateProfileField("subtitle", e.target.value)}
              placeholder="Software Engineer"
            />
          </div>
          <div>
            <Label>Email</Label>
            <Input
              type="email"
              value={profile.email || ""}
              onChange={(e) => updateProfileField("email", e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div>
            <Label>Phone</Label>
            <Input
              value={profile.phone || ""}
              onChange={(e) => updateProfileField("phone", e.target.value)}
              placeholder="+1 234 567 890"
            />
          </div>
          <div className="md:col-span-2">
            <Label>Location</Label>
            <Input
              value={profile.location || ""}
              onChange={(e) => updateProfileField("location", e.target.value)}
              placeholder="San Francisco, CA"
            />
          </div>
          <div>
            <Label>LinkedIn URL</Label>
            <Input
              value={profile.linkedin_url || ""}
              onChange={(e) => updateProfileField("linkedin_url", e.target.value)}
              placeholder="linkedin.com/in/username"
            />
          </div>
          <div>
            <Label>GitHub URL</Label>
            <Input
              value={profile.github_url || ""}
              onChange={(e) => updateProfileField("github_url", e.target.value)}
              placeholder="github.com/username"
            />
          </div>
          <div className="md:col-span-2">
            <Label>Portfolio URL</Label>
            <Input
              value={profile.portfolio_url || ""}
              onChange={(e) => updateProfileField("portfolio_url", e.target.value)}
              placeholder="username.dev"
            />
          </div>
        </div>
      </Section>

      {/* 2. PROFESSIONAL SUMMARY */}
      <Section
        title="Professional Summary"
        icon={<FileText size={15} />}
        isExpanded={expandedSection === "summary"}
        onToggle={() => toggleSection("summary")}
      >
        <Label>Summary Description</Label>
        <Textarea
          value={resume.summary || ""}
          onChange={(e) => updateSummary(e.target.value)}
          placeholder="Tailored professional summary goes here..."
          rows={5}
        />
      </Section>

      {/* 3. SKILLS */}
      <Section
        title="Skills"
        icon={<Code size={15} />}
        isExpanded={expandedSection === "skills"}
        onToggle={() => toggleSection("skills")}
      >
        <div className="space-y-3">
          {Object.entries(resume.skills || {}).map(([category, list]) => (
            <div key={category} className="border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60 p-2.5 rounded space-y-2">
              <div className="flex items-center justify-between gap-2">
                <input
                  type="text"
                  defaultValue={category}
                  onBlur={(e) => updateSkillCategoryName(category, e.target.value)}
                  className="font-bold text-xs uppercase tracking-wider text-zinc-700 dark:text-zinc-300 bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-zinc-500 outline-none px-1 py-0.5"
                />
                <button
                  onClick={() => deleteSkillCategory(category)}
                  className="text-zinc-400 hover:text-red-500 transition-colors p-1"
                  title="Delete category"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              {/* Skill pills */}
              <div className="flex flex-wrap gap-1.5 items-center">
                {list.map((skill) => (
                  <InlineEditSkill
                    key={skill}
                    value={skill}
                    onUpdate={(newVal) => updateSkillInCategory(category, skill, newVal)}
                    onDelete={() => deleteSkillFromCategory(category, skill)}
                  />
                ))}
                <InlineAddSkill onAdd={(val) => addSkillToCategory(category, val)} />
              </div>
            </div>
          ))}

          <button
            onClick={addSkillCategory}
            className="w-full flex items-center justify-center gap-1 py-1.5 text-xs font-bold border border-dashed border-zinc-300 dark:border-zinc-600 hover:border-zinc-400 bg-white dark:bg-zinc-800 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 rounded transition-all cursor-pointer"
          >
            <Plus size={13} />
            Add Skill Category
          </button>
        </div>
      </Section>

      {/* 4. EXPERIENCE */}
      <Section
        title="Experience"
        icon={<Briefcase size={15} />}
        isExpanded={expandedSection === "experience"}
        onToggle={() => toggleSection("experience")}
      >
        <div className="space-y-3">
          {(resume.experiences || []).map((exp, idx) => (
            <ItemCard
              key={idx}
              title={`${exp.role || "Role"} at ${exp.organization || "Company"}`}
              index={idx}
              totalItems={(resume.experiences || []).length}
              onDelete={() => deleteArrayItem("experiences", idx)}
              onMove={(dir) => reorderArrayItem("experiences", idx, dir)}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                <div>
                  <Label>Role</Label>
                  <Input
                    value={exp.role || ""}
                    onChange={(e) => updateArrayItemField("experiences", idx, "role", e.target.value)}
                  />
                </div>
                <div>
                  <Label>Organization</Label>
                  <Input
                    value={exp.organization || ""}
                    onChange={(e) => updateArrayItemField("experiences", idx, "organization", e.target.value)}
                  />
                </div>
                <div>
                  <Label>Location</Label>
                  <Input
                    value={exp.location || ""}
                    onChange={(e) => updateArrayItemField("experiences", idx, "location", e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Start Date</Label>
                    <Input
                      value={exp.start_date || ""}
                      onChange={(e) => updateArrayItemField("experiences", idx, "start_date", e.target.value)}
                      placeholder="YYYY-MM-DD"
                    />
                  </div>
                  <div>
                    <Label>End Date</Label>
                    <Input
                      value={exp.end_date || ""}
                      onChange={(e) => updateArrayItemField("experiences", idx, "end_date", e.target.value)}
                      placeholder="YYYY-MM-DD / Present"
                    />
                  </div>
                </div>
              </div>

              {/* Bullet points */}
              <div className="mt-3.5 space-y-2.5 border-t border-zinc-100 dark:border-zinc-700 pt-3">
                <Label>Bullet Points</Label>
                {(exp.bullet_points || []).map((bullet: string, bIdx: number) => (
                  <div key={bIdx} className="flex gap-2 items-start">
                    <span className="text-[10px] font-bold text-zinc-400 mt-2 shrink-0">{bIdx + 1}.</span>
                    <Textarea
                      value={bullet}
                      onChange={(e) => updateBulletPoint("experiences", idx, bIdx, e.target.value)}
                      rows={3}
                      placeholder="Experience achievement bullet point..."
                    />
                    <button
                      onClick={() => deleteBulletPoint("experiences", idx, bIdx)}
                      className="text-zinc-400 hover:text-red-500 p-1 mt-1.5 transition-colors shrink-0"
                      title="Delete bullet"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => addBulletPoint("experiences", idx)}
                  className="flex items-center gap-1 text-[11px] font-semibold border border-dashed border-zinc-300 dark:border-zinc-600 hover:border-zinc-400 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 bg-white dark:bg-zinc-800 px-2.5 py-1 rounded transition-all cursor-pointer mt-1"
                >
                  <Plus size={11} /> Add Bullet Point
                </button>
              </div>
            </ItemCard>
          ))}

          <button
            onClick={() =>
              addArrayItem("experiences", {
                role: "",
                organization: "",
                location: "",
                start_date: "",
                end_date: "",
                bullet_points: [],
              })
            }
            className="w-full flex items-center justify-center gap-1 py-1.5 text-xs font-bold border border-dashed border-zinc-300 dark:border-zinc-600 hover:border-zinc-400 bg-white dark:bg-zinc-800 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 rounded transition-all cursor-pointer"
          >
            <Plus size={13} />
            Add Experience
          </button>
        </div>
      </Section>

      {/* 5. PROJECTS */}
      <Section
        title="Projects"
        icon={<FolderGit size={15} />}
        isExpanded={expandedSection === "projects"}
        onToggle={() => toggleSection("projects")}
      >
        <div className="space-y-3">
          {(resume.projects || []).map((proj, idx) => (
            <ItemCard
              key={idx}
              title={proj.name || "Project Name"}
              index={idx}
              totalItems={(resume.projects || []).length}
              onDelete={() => deleteArrayItem("projects", idx)}
              onMove={(dir) => reorderArrayItem("projects", idx, dir)}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                <div className="md:col-span-2">
                  <Label>Project Name</Label>
                  <Input
                    value={proj.name || ""}
                    onChange={(e) => updateArrayItemField("projects", idx, "name", e.target.value)}
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>Subtitle / Brief Summary</Label>
                  <Input
                    value={proj.project_summary || ""}
                    onChange={(e) => updateArrayItemField("projects", idx, "project_summary", e.target.value)}
                    placeholder="Short project summary (e.g. Chrome Extension for SEO)"
                  />
                </div>
                <div>
                  <Label>Project Link</Label>
                  <Input
                    value={proj.github_url || proj.live_url || ""}
                    onChange={(e) => {
                      updateArrayItemField("projects", idx, "github_url", e.target.value)
                      updateArrayItemField("projects", idx, "live_url", e.target.value)
                    }}
                    placeholder="github.com/project-link"
                  />
                </div>
                <div>
                  <Label>Technologies (Comma separated)</Label>
                  <Input
                    value={(proj.technologies || []).join(", ")}
                    onChange={(e) => {
                      const tags = e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
                      updateArrayItemField("projects", idx, "technologies", tags)
                    }}
                    placeholder="React, Tailwind, Node.js"
                  />
                </div>
              </div>

              {/* Bullet points */}
              <div className="mt-3.5 space-y-2.5 border-t border-zinc-100 dark:border-zinc-700 pt-3">
                <Label>Bullet Points</Label>
                {(proj.bullet_points || []).map((bullet: string, bIdx: number) => (
                  <div key={bIdx} className="flex gap-2 items-start">
                    <span className="text-[10px] font-bold text-zinc-400 mt-2 shrink-0">{bIdx + 1}.</span>
                    <Textarea
                      value={bullet}
                      onChange={(e) => updateBulletPoint("projects", idx, bIdx, e.target.value)}
                      rows={3}
                      placeholder="Project achievement bullet point..."
                    />
                    <button
                      onClick={() => deleteBulletPoint("projects", idx, bIdx)}
                      className="text-zinc-400 hover:text-red-500 p-1 mt-1.5 transition-colors shrink-0"
                      title="Delete bullet"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => addBulletPoint("projects", idx)}
                  className="flex items-center gap-1 text-[11px] font-semibold border border-dashed border-zinc-300 dark:border-zinc-600 hover:border-zinc-400 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 bg-white dark:bg-zinc-800 px-2.5 py-1 rounded transition-all cursor-pointer mt-1"
                >
                  <Plus size={11} /> Add Bullet Point
                </button>
              </div>
            </ItemCard>
          ))}

          <button
            onClick={() =>
              addArrayItem("projects", {
                name: "",
                project_summary: "",
                technologies: [],
                bullet_points: [],
                github_url: "",
                live_url: "",
              })
            }
            className="w-full flex items-center justify-center gap-1 py-1.5 text-xs font-bold border border-dashed border-zinc-300 dark:border-zinc-600 hover:border-zinc-400 bg-white dark:bg-zinc-800 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 rounded transition-all cursor-pointer"
          >
            <Plus size={13} />
            Add Project
          </button>
        </div>
      </Section>

      {/* 6. EDUCATION */}
      <Section
        title="Education"
        icon={<GraduationCap size={15} />}
        isExpanded={expandedSection === "education"}
        onToggle={() => toggleSection("education")}
      >
        <div className="space-y-3">
          {(resume.education || []).map((edu, idx) => (
            <ItemCard
              key={idx}
              title={`${edu.degree || "Degree"} at ${edu.institution || "Institution"}`}
              index={idx}
              totalItems={(resume.education || []).length}
              onDelete={() => deleteArrayItem("education", idx)}
              onMove={(dir) => reorderArrayItem("education", idx, dir)}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                <div>
                  <Label>Degree / Program</Label>
                  <Input
                    value={edu.degree || ""}
                    onChange={(e) => updateArrayItemField("education", idx, "degree", e.target.value)}
                  />
                </div>
                <div>
                  <Label>Institution Name</Label>
                  <Input
                    value={edu.institution || ""}
                    onChange={(e) => updateArrayItemField("education", idx, "institution", e.target.value)}
                  />
                </div>
                <div>
                  <Label>Location</Label>
                  <Input
                    value={edu.location || ""}
                    onChange={(e) => updateArrayItemField("education", idx, "location", e.target.value)}
                    placeholder="San Francisco, CA"
                  />
                </div>
                <div>
                  <Label>GPA</Label>
                  <Input
                    value={edu.gpa || ""}
                    onChange={(e) => updateArrayItemField("education", idx, "gpa", e.target.value)}
                    placeholder="3.8 / 4.0"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Start Date</Label>
                    <Input
                      value={edu.start_date || ""}
                      onChange={(e) => updateArrayItemField("education", idx, "start_date", e.target.value)}
                      placeholder="YYYY-MM-DD"
                    />
                  </div>
                  <div>
                    <Label>End Date</Label>
                    <Input
                      value={edu.end_date || ""}
                      onChange={(e) => updateArrayItemField("education", idx, "end_date", e.target.value)}
                      placeholder="YYYY-MM-DD / Present"
                    />
                  </div>
                </div>
              </div>
            </ItemCard>
          ))}

          <button
            onClick={() =>
              addArrayItem("education", {
                degree: "",
                institution: "",
                location: "",
                start_date: "",
                end_date: "",
                gpa: "",
              })
            }
            className="w-full flex items-center justify-center gap-1 py-1.5 text-xs font-bold border border-dashed border-zinc-300 dark:border-zinc-600 hover:border-zinc-400 bg-white dark:bg-zinc-800 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 rounded transition-all cursor-pointer"
          >
            <Plus size={13} />
            Add Education
          </button>
        </div>
      </Section>

      {/* 7. EXTRA-CURRICULAR ACTIVITIES & ACHIEVEMENTS */}
      <Section
        title="Extra-Curriculars"
        icon={<Award size={15} />}
        isExpanded={expandedSection === "extracurriculars"}
        onToggle={() => toggleSection("extracurriculars")}
      >
        <div className="space-y-3">
          {(resume.extracurriculars || []).map((ex, idx) => (
            <div key={idx} className="border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/80 p-3 rounded relative group/extra">
              <div className="flex gap-2 items-start">
                <Textarea
                  value={ex.description || ""}
                  onChange={(e) => updateArrayItemField("extracurriculars", idx, "description", e.target.value)}
                  placeholder="Extracurricular activity or achievement description..."
                  rows={3}
                />
                <div className="flex flex-col gap-1 items-center shrink-0">
                  <button
                    onClick={() => deleteArrayItem("extracurriculars", idx)}
                    className="text-zinc-400 hover:text-red-500 p-1 transition-colors"
                    title="Delete item"
                  >
                    <Trash2 size={13} />
                  </button>
                  {idx > 0 && (
                    <button
                      onClick={() => reorderArrayItem("extracurriculars", idx, "up")}
                      className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 p-0.5 cursor-pointer"
                    >
                      <ArrowUp size={11} />
                    </button>
                  )}
                  {idx < (resume.extracurriculars || []).length - 1 && (
                    <button
                      onClick={() => reorderArrayItem("extracurriculars", idx, "down")}
                      className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 p-0.5 cursor-pointer"
                    >
                      <ArrowDown size={11} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}

          <button
            onClick={() => addArrayItem("extracurriculars", { description: "" })}
            className="w-full flex items-center justify-center gap-1 py-1.5 text-xs font-bold border border-dashed border-zinc-300 dark:border-zinc-600 hover:border-zinc-400 bg-white dark:bg-zinc-800 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 rounded transition-all cursor-pointer"
          >
            <Plus size={13} />
            Add Achievement
          </button>
        </div>
      </Section>
    </div>
  )
}

// Inline skill pill edit input
function InlineEditSkill({
  value,
  onUpdate,
  onDelete,
}: {
  value: string
  onUpdate: (newVal: string) => void
  onDelete: () => void
}) {
  const [val, setVal] = useState(value)
  const [editing, setEditing] = useState(false)

  function submit() {
    if (val.trim() && val.trim() !== value) {
      onUpdate(val.trim())
    } else {
      setVal(value)
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="inline-flex items-center gap-1 border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-1.5 py-0.5 rounded">
        <input
          type="text"
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={submit}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="text-[11px] font-semibold outline-none w-20 bg-transparent dark:text-zinc-100"
        />
      </div>
    )
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className="inline-flex items-center gap-1 text-[11px] font-semibold bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 px-2 py-0.5 rounded shadow-sm cursor-pointer hover:border-zinc-400 select-none"
      title="Click to edit skill"
    >
      {value}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        className="text-zinc-500 hover:text-red-500 font-bold ml-0.5 cursor-pointer"
        title="Delete skill"
      >
        ×
      </button>
    </span>
  )
}

// Inline skill pill add input
function InlineAddSkill({ onAdd }: { onAdd: (val: string) => void }) {
  const [val, setVal] = useState("")
  const [open, setOpen] = useState(false)

  function submit() {
    if (val.trim()) {
      onAdd(val.trim())
      setVal("")
    }
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-[10px] font-bold border border-dashed border-zinc-350 dark:border-zinc-600 hover:border-zinc-500 text-zinc-600 dark:text-zinc-400 bg-white dark:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 px-2 py-0.5 rounded transition-all cursor-pointer"
      >
        <Plus size={10} /> Add
      </button>
    )
  }

  return (
    <div className="inline-flex items-center gap-1 border border-zinc-400 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-1.5 py-0.5 rounded">
      <input
        type="text"
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={submit}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        className="text-[11px] font-semibold outline-none w-14 bg-transparent dark:text-zinc-100"
      />
    </div>
  )
}

// Helper components for layout & consistency
function Section({
  title,
  icon,
  isExpanded,
  onToggle,
  children,
}: {
  title: string
  icon: React.ReactNode
  isExpanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 rounded-md overflow-hidden shadow-sm">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 bg-zinc-50/80 dark:bg-zinc-800/80 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-left font-black uppercase text-xs tracking-wider text-zinc-800 dark:text-zinc-200 outline-none border-b border-zinc-200 dark:border-zinc-700 cursor-pointer transition-colors"
      >
        <span className="text-zinc-500 shrink-0">{icon}</span>
        <span>{title}</span>
        <span className="ml-auto text-zinc-500">
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>
      {isExpanded && <div className="p-3 bg-white dark:bg-zinc-900">{children}</div>}
    </div>
  )
}

function ItemCard({
  title,
  index,
  totalItems,
  onDelete,
  onMove,
  children,
}: {
  title: string
  index: number
  totalItems: number
  onDelete: () => void
  onMove: (dir: "up" | "down") => void
  children: React.ReactNode
}) {
  return (
    <div className="border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 rounded overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-3 py-1.5 bg-zinc-100/70 dark:bg-zinc-800/70 border-b border-zinc-200 dark:border-zinc-700">
        <span className="text-[11px] font-bold text-zinc-700 dark:text-zinc-300 truncate">{title}</span>
        <div className="flex items-center gap-1 shrink-0">
          {index > 0 && (
            <button onClick={() => onMove("up")} className="p-1 hover:bg-zinc-200/80 dark:hover:bg-zinc-700 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 rounded cursor-pointer transition-colors" title="Move Up">
              <ArrowUp size={11} />
            </button>
          )}
          {index < totalItems - 1 && (
            <button onClick={() => onMove("down")} className="p-1 hover:bg-zinc-200/80 dark:hover:bg-zinc-700 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 rounded cursor-pointer transition-colors" title="Move Down">
              <ArrowDown size={11} />
            </button>
          )}
          <button onClick={onDelete} className="p-1 text-zinc-400 hover:text-red-500 rounded ml-0.5 cursor-pointer transition-colors" title="Delete">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      {/* Body */}
      <div className="p-3 space-y-2.5">{children}</div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1">{children}</div>
}

// Style overrides
function Input(props: React.ComponentProps<"input">) {
  return (
    <input
      {...props}
      className="w-full h-8 text-xs font-semibold px-2 border border-zinc-300 dark:border-zinc-600 rounded focus:border-zinc-800 dark:focus:border-zinc-400 focus:ring-1 focus:ring-[#ff4e26]/5 outline-none transition-all placeholder:text-zinc-400 dark:placeholder:text-zinc-500 bg-white dark:bg-zinc-800 dark:text-zinc-100"
    />
  )
}

function Textarea({ className = "", ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      {...props}
      className={`w-full p-2 text-xs font-semibold border border-zinc-300 dark:border-zinc-600 rounded focus:border-zinc-800 dark:focus:border-zinc-400 focus:ring-1 focus:ring-[#ff4e26]/5 outline-none transition-all resize-y placeholder:text-zinc-400 dark:placeholder:text-zinc-500 bg-white dark:bg-zinc-800 dark:text-zinc-100 ${className}`}
    />
  )
}
