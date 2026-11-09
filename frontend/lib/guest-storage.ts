import type { GuestDraft, GuestExperience, GuestProject } from "@/lib/guest-types"

const STORAGE_KEY = "resumer_guest_draft_v1"
const GENERATE_STORAGE_KEY = "resumer_guest_generate_v1"

export const emptyGuestDraft = (): GuestDraft => ({
  profile: {},
  experiences: [],
  projects: [],
  education: [],
  extracurriculars: [],
  updatedAt: new Date().toISOString(),
})

export function loadGuestDraft(): GuestDraft {
  if (typeof window === "undefined") return emptyGuestDraft()
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return emptyGuestDraft()
  try {
    return { ...emptyGuestDraft(), ...JSON.parse(raw) }
  } catch {
    return emptyGuestDraft()
  }
}

export function saveGuestDraft(draft: GuestDraft) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...draft, updatedAt: new Date().toISOString() }))
}

export function clearGuestDraft() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(STORAGE_KEY)
}

export type GuestGenerateForm = {
  jobDescription: string
  keywords: string
  instructions: string
  focus: string
  creativityMode: string
}

export const emptyGuestGenerate = (): GuestGenerateForm => ({
  jobDescription: "",
  keywords: "",
  instructions: "",
  focus: "balanced",
  creativityMode: "proper",
})

export function loadGuestGenerate(): GuestGenerateForm {
  if (typeof window === "undefined") return emptyGuestGenerate()
  const raw = window.localStorage.getItem(GENERATE_STORAGE_KEY)
  if (!raw) return emptyGuestGenerate()
  try {
    return { ...emptyGuestGenerate(), ...JSON.parse(raw) }
  } catch {
    return emptyGuestGenerate()
  }
}

export function saveGuestGenerate(form: GuestGenerateForm) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(GENERATE_STORAGE_KEY, JSON.stringify(form))
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== ""
}

function hasNonBlankItem(values: string[] | null | undefined): boolean {
  return Array.isArray(values) && values.some((v) => typeof v === "string" && v.trim() !== "")
}

export function experienceUsable(exp: GuestExperience): boolean {
  return (
    hasText(exp.role) &&
    hasText(exp.organization) &&
    hasNonBlankItem(exp.bullet_points ?? null)
  )
}

export function projectUsable(proj: GuestProject): boolean {
  return hasText(proj.name) && (hasText(proj.description ?? null) || hasNonBlankItem(proj.bullet_points ?? null))
}

export function usableExperiences(experiences: GuestExperience[]): GuestExperience[] {
  return experiences.filter(experienceUsable)
}

export function usableProjects(projects: GuestProject[]): GuestProject[] {
  return projects.filter(projectUsable)
}

export function incompleteExperienceMessages(experiences: GuestExperience[]): string[] {
  const messages: string[] = []
  experiences.forEach((exp, i) => {
    if (experienceUsable(exp)) return
    const missing: string[] = []
    if (!hasText(exp.role)) missing.push("a role")
    if (!hasText(exp.organization)) missing.push("an organization")
    if (!hasNonBlankItem(exp.bullet_points ?? null)) missing.push("a bullet point")
    messages.push(`Experience ${i + 1} needs ${missing.join(" and ")}`)
  })
  return messages
}

export function incompleteProjectMessages(projects: GuestProject[]): string[] {
  const messages: string[] = []
  projects.forEach((proj, i) => {
    if (projectUsable(proj)) return
    const missing: string[] = []
    if (!hasText(proj.name)) missing.push("a name")
    if (!hasText(proj.description ?? null) && !hasNonBlankItem(proj.bullet_points ?? null)) {
      missing.push("a description or bullet")
    }
    messages.push(`Project ${i + 1} needs ${missing.join(" and ")}`)
  })
  return messages
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s\-_.,]+/g, " ").trim()
}

export type MergeResult = {
  draft: GuestDraft
  skipped: number
  added: number
}

export function mergeGuestDraft(current: GuestDraft, incoming: Partial<GuestDraft>): MergeResult {
  let skipped = 0
  let added = 0

  // Profile: fill empty fields only, merge skills dedup
  const profile = { ...current.profile }
  for (const [key, value] of Object.entries(incoming.profile ?? {})) {
    if (key === "skills") {
      const merged = [...(profile.skills ?? []), ...((value as string[] | null) ?? [])]
      profile.skills = Array.from(new Set(merged.map((s) => s.trim()).filter(Boolean)))
    } else if (value && !profile[key as keyof typeof profile]) {
      ;(profile as Record<string, unknown>)[key] = value
    }
  }

  // Experiences: skip if role+org already exists
  const existingExpKeys = new Set(current.experiences.map((e) => norm(e.role + " " + e.organization)))
  const newExperiences = [...current.experiences]
  for (const exp of incoming.experiences ?? []) {
    const key = norm(exp.role + " " + exp.organization)
    if (existingExpKeys.has(key)) { skipped++; continue }
    existingExpKeys.add(key)
    newExperiences.push(exp)
    added++
  }

  // Projects: skip if name already exists
  const existingProjKeys = new Set(current.projects.map((p) => norm(p.name)))
  const newProjects = [...current.projects]
  for (const proj of incoming.projects ?? []) {
    const key = norm(proj.name)
    if (existingProjKeys.has(key)) { skipped++; continue }
    existingProjKeys.add(key)
    newProjects.push(proj)
    added++
  }

  // Education: skip if degree+institution already exists
  const existingEduKeys = new Set(current.education.map((e) => norm(e.degree + " " + e.institution)))
  const newEducation = [...current.education]
  for (const edu of incoming.education ?? []) {
    const key = norm(edu.degree + " " + edu.institution)
    if (existingEduKeys.has(key)) { skipped++; continue }
    existingEduKeys.add(key)
    newEducation.push(edu)
    added++
  }

  // Extracurriculars: skip if title+org already exists
  const existingExtraKeys = new Set(current.extracurriculars.map((e) => norm(e.title + " " + (e.organization ?? ""))))
  const newExtracurriculars = [...current.extracurriculars]
  for (const extra of incoming.extracurriculars ?? []) {
    const key = norm(extra.title + " " + (extra.organization ?? ""))
    if (existingExtraKeys.has(key)) { skipped++; continue }
    existingExtraKeys.add(key)
    newExtracurriculars.push(extra)
    added++
  }

  return {
    draft: {
      profile,
      experiences: newExperiences,
      projects: newProjects,
      education: newEducation,
      extracurriculars: newExtracurriculars,
      updatedAt: new Date().toISOString(),
    },
    skipped,
    added,
  }
}
