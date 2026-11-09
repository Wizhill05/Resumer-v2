"use client"

import { useQuery } from "@tanstack/react-query"

type Profile = { full_name?: string; email?: string }
type Entry = { id: string }

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load ${url}`)
  return res.json()
}

/** Profile sections in the order the editor shows them. */
export type ProfileSection = "basic" | "experience" | "projects" | "education" | "extracurricular"

export const PROFILE_SECTION_LABELS: Record<ProfileSection, string> = {
  basic: "Basic info",
  experience: "Experience",
  projects: "Project",
  education: "Education",
  extracurricular: "Activity",
}

/**
 * Whether the user has filled in enough to generate a résumé: basic info plus
 * at least one entry in every section. Shares query keys with the profile
 * forms, so it reads from the same cache and updates when they save.
 */
export function useProfileCompleteness() {
  const profile = useQuery<Profile>({ queryKey: ["profile"], queryFn: () => getJson("/api/backend/profile") })
  const experiences = useQuery<Entry[]>({ queryKey: ["experiences"], queryFn: () => getJson("/api/backend/profile/experiences") })
  const projects = useQuery<Entry[]>({ queryKey: ["projects"], queryFn: () => getJson("/api/backend/profile/projects") })
  const education = useQuery<Entry[]>({ queryKey: ["education"], queryFn: () => getJson("/api/backend/profile/education") })
  const extracurriculars = useQuery<Entry[]>({ queryKey: ["extracurriculars"], queryFn: () => getJson("/api/backend/profile/extracurriculars") })

  const isLoading = [profile, experiences, projects, education, extracurriculars].some((query) => query.isLoading)
  const filled: Record<ProfileSection, boolean> = {
    basic: !!profile.data?.full_name && !!profile.data?.email,
    experience: (experiences.data?.length ?? 0) >= 1,
    projects: (projects.data?.length ?? 0) >= 1,
    education: (education.data?.length ?? 0) >= 1,
    extracurricular: (extracurriculars.data?.length ?? 0) >= 1,
  }
  const missingSections = (Object.keys(filled) as ProfileSection[]).filter((section) => !filled[section])
  const missing = missingSections.map((section) => PROFILE_SECTION_LABELS[section])

  // Changes whenever any section refetches (e.g. after a save), so dependent
  // queries like generation readiness can key off it.
  const version = [profile, experiences, projects, education, extracurriculars]
    .map((query) => query.dataUpdatedAt)
    .join(":")

  return {
    isLoading,
    version,
    hasName: !!profile.data?.full_name,
    filled,
    missingSections,
    missing,
    complete: !isLoading && missing.length === 0,
  }
}
