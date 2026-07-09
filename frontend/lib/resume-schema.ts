/**
 * resume-schema.ts — Types and Zod validation for the tailored resume JSON
 * stored in render_metadata.tailored_resume. Mirrors the backend pipeline schema.
 */

import { z } from "zod"

export const SkillsSchema = z.record(z.string(), z.array(z.string()))

export const ExperienceSchema = z.object({
  role: z.string(),
  organization: z.string(),
  location: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional().nullable(),
  bullet_points: z.array(z.string()).default([]),
})

export const ProjectSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  technologies: z.array(z.string()).optional().default([]),
  bullet_points: z.array(z.string()).default([]),
  github_url: z.string().optional().nullable(),
  live_url: z.string().optional().nullable(),
  project_summary: z.string().optional().nullable(),
})

export const EducationSchema = z.object({
  degree: z.string(),
  institution: z.string(),
  location: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  gpa: z.string().optional().nullable(),
})

export const ExtracurricularSchema = z.object({
  description: z.string(),
})

export const TailoredResumeSchema = z.object({
  summary: z.string().optional(),
  skills: SkillsSchema.optional().default({}),
  experiences: z.array(ExperienceSchema).optional().default([]),
  projects: z.array(ProjectSchema).optional().default([]),
  education: z.array(EducationSchema).optional().default([]),
  extracurriculars: z.array(ExtracurricularSchema).optional().default([]),
})

export type TailoredResume = z.infer<typeof TailoredResumeSchema>

// ── Editor API types ───────────────────────────────────────────────────────────

export type EditorManifest = {
  min_font_size: number
  max_font_size: number
  target_pages: number
  page_margin_mm: number
}

export type EditorProfile = {
  full_name?: string | null
  email?: string | null
  phone?: string | null
  location?: string | null
  linkedin_url?: string | null
  github_url?: string | null
  portfolio_url?: string | null
  subtitle?: string | null
}

export type EditorPayload = {
  id: string
  template_id: string
  job_title?: string | null
  company?: string | null
  status: string
  editor_revision: number
  profile: EditorProfile
  tailored_resume: Record<string, unknown>
  font_size?: number | null
  page_count?: number | null
  fit_warning: boolean
  manifest: EditorManifest
}

export type RenderHtmlResponse = {
  html: string
  template_id: string
}

export type EditorSaveResponse = {
  editor_revision: number
  font_size: number
  page_count: number
  fit_warning: boolean
  pdf_storage_key?: string | null
  thumb_storage_key?: string | null
}
