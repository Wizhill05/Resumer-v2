import { z } from "zod"

/**
 * Valid body section identifiers supported by the template section order system.
 * 'experiences' is intentionally plural to match resume JSON and backend contract.
 */
export const SECTION_IDS = [
  "summary",
  "education",
  "skills",
  "projects",
  "experiences",
  "extracurriculars",
] as const

export const SectionIdSchema = z.enum(SECTION_IDS)
export type SectionId = z.infer<typeof SectionIdSchema>

export const DEFAULT_SECTION_ORDER: readonly SectionId[] = [
  "summary",
  "education",
  "skills",
  "projects",
  "experiences",
  "extracurriculars",
] as const

export const SECTION_METADATA: Record<
  SectionId,
  {
    label: string
    shortDescription: string
    outlineHint: string
  }
> = {
  summary: {
    label: "Professional summary",
    shortDescription: "A short introduction to your background",
    outlineHint: "Executive summary paragraph & primary value proposition",
  },
  education: {
    label: "Education",
    shortDescription: "Degrees, schools, and qualifications",
    outlineHint: "Degrees, institutions, completion dates, and coursework",
  },
  skills: {
    label: "Skills",
    shortDescription: "Tools, technologies, and strengths",
    outlineHint: "Categorized skill badges & competencies",
  },
  projects: {
    label: "Projects",
    shortDescription: "Selected projects and what you built",
    outlineHint: "Projects with tech stack, links, and impact bullets",
  },
  experiences: {
    label: "Experience",
    shortDescription: "Roles, companies, and accomplishments",
    outlineHint: "Roles, organizations, employment dates, and tailored bullets",
  },
  extracurriculars: {
    label: "Activities & achievements",
    shortDescription: "Awards, leadership, and interests",
    outlineHint: "Leadership roles, honors, awards, and certifications",
  },
}

export const FIXED_HEADER_METADATA = {
  label: "Name & contact details",
  shortDescription: "Full name, email, phone number, location, and professional links",
  outlineHint: "Fixed at page top &bull; candidate identity and contact row",
}

/**
 * Validates that an arbitrary value is an exact permutation of all 6 section IDs.
 */
export function isValidSectionOrder(order: unknown): order is SectionId[] {
  if (!Array.isArray(order) || order.length !== SECTION_IDS.length) {
    return false
  }

  const seen = new Set<string>()
  for (const item of order) {
    if (typeof item !== "string" || !SECTION_IDS.includes(item as SectionId)) {
      return false
    }
    if (seen.has(item)) {
      return false
    }
    seen.add(item)
  }

  return seen.size === SECTION_IDS.length
}

export const TemplateLayoutResponseSchema = z.object({
  template_id: z.string(),
  default_section_order: z.array(SectionIdSchema).refine(isValidSectionOrder, {
    message: "default_section_order must contain every supported section ID exactly once",
  }),
  section_order: z.array(SectionIdSchema).refine(isValidSectionOrder, {
    message: "section_order must contain every supported section ID exactly once",
  }),
})

export type TemplateLayoutResponse = z.infer<typeof TemplateLayoutResponseSchema>

export const TemplateLayoutPutBodySchema = z.object({
  section_order: z.array(SectionIdSchema).refine(isValidSectionOrder, {
    message: "section_order must contain every supported section ID exactly once",
  }),
})

export type TemplateLayoutPutBody = z.infer<typeof TemplateLayoutPutBodySchema>

/**
 * Fetches the saved template layout preference for the current user and specified template.
 */
export async function fetchTemplateLayout(
  templateId: string,
  signal?: AbortSignal
): Promise<TemplateLayoutResponse> {
  const res = await fetch(`/api/backend/templates/${encodeURIComponent(templateId)}/layout`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    signal,
    cache: "no-store",
  })

  if (!res.ok) {
    let errorDetail = `Failed to load layout (status ${res.status})`
    try {
      const data = await res.json()
      if (data && typeof data.detail === "string") {
        errorDetail = data.detail
      }
    } catch {
      // Ignore JSON parse error on non-JSON response
    }
    throw new Error(errorDetail)
  }

  const json = await res.json()
  const parsed = TemplateLayoutResponseSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(
      `Invalid template layout response from server: ${parsed.error.issues.map((i) => i.message).join(", ")}`
    )
  }

  return parsed.data
}

/**
 * Persists the preferred section order for the specified template.
 */
export async function saveTemplateLayout(
  templateId: string,
  sectionOrder: SectionId[],
  signal?: AbortSignal
): Promise<TemplateLayoutResponse> {
  if (!isValidSectionOrder(sectionOrder)) {
    throw new Error("Invalid section order permutation")
  }

  const res = await fetch(`/api/backend/templates/${encodeURIComponent(templateId)}/layout`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ section_order: sectionOrder }),
    signal,
  })

  if (!res.ok) {
    let errorDetail = `Failed to save template layout (status ${res.status})`
    try {
      const data = await res.json()
      if (data && typeof data.detail === "string") {
        errorDetail = data.detail
      }
    } catch {
      // Ignore JSON parse error on non-JSON response
    }
    throw new Error(errorDetail)
  }

  const json = await res.json()
  const parsed = TemplateLayoutResponseSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(
      `Invalid template layout response after saving: ${parsed.error.issues.map((i) => i.message).join(", ")}`
    )
  }

  return parsed.data
}

export const TemplatePreviewResponseSchema = z.object({
  template_id: z.string(),
  page_images: z.array(z.string()),
  page_count: z.number(),
  font_size: z.number(),
  fit_warning: z.boolean(),
  section_order: z.array(SectionIdSchema).refine(isValidSectionOrder, {
    message: "section_order must contain every supported section ID exactly once",
  }),
})

export type TemplatePreviewResponse = z.infer<typeof TemplatePreviewResponseSchema>

/**
 * Fetches authentic WeasyPrint rendered preview pages for the specified template and section order.
 * Safe: uses fictional sample fixture (Dario Altman) and does not consume LLM credits.
 */
export async function fetchTemplatePreview(
  templateId: string,
  sectionOrder?: SectionId[],
  signal?: AbortSignal
): Promise<TemplatePreviewResponse> {
  const body = sectionOrder ? JSON.stringify({ section_order: sectionOrder }) : JSON.stringify({})
  const res = await fetch(`/api/backend/templates/${encodeURIComponent(templateId)}/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body,
    signal,
  })

  if (!res.ok) {
    let errorDetail = `Failed to render preview (status ${res.status})`
    try {
      const data = await res.json()
      if (data && typeof data.detail === "string") {
        errorDetail = data.detail
      }
    } catch {
      // Ignore JSON parse error on non-JSON response
    }
    throw new Error(errorDetail)
  }

  const json = await res.json()
  const parsed = TemplatePreviewResponseSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(
      `Invalid template preview response: ${parsed.error.issues.map((i) => i.message).join(", ")}`
    )
  }

  return parsed.data
}

