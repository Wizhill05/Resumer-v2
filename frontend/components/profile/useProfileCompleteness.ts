"use client"

import { useQuery } from "@tanstack/react-query"

type Profile = { full_name?: string; email?: string }
type Entry = { id: string }

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load ${url}`)
  return res.json()
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
  const missing = [
    !profile.data?.full_name || !profile.data?.email ? "Basic info" : null,
    (experiences.data?.length ?? 0) < 1 ? "Experience" : null,
    (projects.data?.length ?? 0) < 1 ? "Project" : null,
    (education.data?.length ?? 0) < 1 ? "Education" : null,
    (extracurriculars.data?.length ?? 0) < 1 ? "Activity" : null,
  ].filter(Boolean) as string[]

  return {
    isLoading,
    missing,
    complete: !isLoading && missing.length === 0,
  }
}
