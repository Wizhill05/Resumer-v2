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

export const SANS_DEFAULT_SECTION_ORDER: readonly SectionId[] = [
  "summary",
  "experiences",
  "projects",
  "skills",
  "education",
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
 * Validates that an arbitrary value is a non-empty array of unique, supported section IDs.
 * Accepts any valid subset of SECTION_IDS (1 to 6 sections) without duplicates or unknown IDs.
 */
export function isValidSectionSubset(order: unknown): order is SectionId[] {
  if (!Array.isArray(order) || order.length === 0) {
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

  return seen.size === order.length
}

/**
 * Validates that an arbitrary value is an exact permutation of supported sections.
 * If supportedSections is omitted, defaults to all 6 SECTION_IDS.
 * Rejects:
 * - non-arrays
 * - duplicate section IDs
 * - unknown section IDs not in supportedSections
 * - missing section IDs from supportedSections
 * - extra section IDs
 */
export function isValidSectionOrder(
  order: unknown,
  supportedSections: readonly SectionId[] = SECTION_IDS
): order is SectionId[] {
  if (!Array.isArray(order) || order.length !== supportedSections.length) {
    return false
  }

  const expectedSet = new Set<string>(supportedSections)
  const seen = new Set<string>()
  for (const item of order) {
    if (typeof item !== "string" || !expectedSet.has(item)) {
      return false
    }
    if (seen.has(item)) {
      return false
    }
    seen.add(item)
  }

  return seen.size === supportedSections.length
}

export const ContentSplitSchema = z.object({
  projects: z.number(),
  experience: z.number(),
  label: z.string(),
})

export type ContentSplit = z.infer<typeof ContentSplitSchema>

export const TemplateItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  preview_image: z.string().optional(),
  has_photo: z.boolean().optional().default(false),
  has_summary: z.boolean().optional().default(true),
  has_objective: z.boolean().optional().default(false),
  has_links: z.boolean().optional().default(true),
  has_education: z.boolean().optional().default(true),
  has_extracurricular: z.boolean().optional().default(false),
  content_slots: z.number().int().positive().optional().default(6),
  allowed_content_splits: z.array(ContentSplitSchema).optional().default([]),
  default_content_split: ContentSplitSchema.optional(),
  default_section_order: z
    .array(SectionIdSchema)
    .refine(isValidSectionSubset, {
      message: "default_section_order must contain unique known section IDs without duplicates",
    })
    .optional(),
})

export type TemplateItem = z.infer<typeof TemplateItemSchema>

export const TemplateListResponseSchema = z.array(TemplateItemSchema)

/**
 * Sorts template manifests so Personal Classic comes first, Professional Sans second,
 * and any future templates follow in alphabetical order.
 */
export function sortTemplates<T extends { id: string; name: string }>(templates: T[]): T[] {
  const priorityOrder = ["personal-classic", "professional-sans"]
  return [...templates].sort((a, b) => {
    const idxA = priorityOrder.indexOf(a.id)
    const idxB = priorityOrder.indexOf(b.id)
    if (idxA !== -1 && idxB !== -1) return idxA - idxB
    if (idxA !== -1) return -1
    if (idxB !== -1) return 1
    return a.name.localeCompare(b.name)
  })
}

/**
 * Fetches available templates, validates response with Zod, and sorts templates
 * preserving Personal Classic first and Professional Sans second.
 */
export async function fetchTemplates(signal?: AbortSignal): Promise<TemplateItem[]> {
  const res = await fetch("/api/backend/templates", {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    signal,
  })

  if (!res.ok) {
    let errorDetail = `Failed to load templates (status ${res.status})`
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
  const parsed = TemplateListResponseSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(
      `Invalid templates response from server: ${parsed.error.issues.map((i) => i.message).join(", ")}`
    )
  }

  return sortTemplates(parsed.data)
}

export const TemplateLayoutResponseSchema = z
  .object({
    template_id: z.string(),
    default_section_order: z.array(SectionIdSchema).refine(isValidSectionSubset, {
      message: "default_section_order must contain unique valid section IDs",
    }),
    section_order: z.array(SectionIdSchema).refine(isValidSectionSubset, {
      message: "section_order must contain unique valid section IDs",
    }),
  })
  .refine(
    (data) => isValidSectionOrder(data.section_order, data.default_section_order),
    {
      message: "section_order must be an exact permutation of the template's default_section_order",
    }
  )

export type TemplateLayoutResponse = z.infer<typeof TemplateLayoutResponseSchema>

export const TemplateLayoutPutBodySchema = z.object({
  section_order: z.array(SectionIdSchema).refine(isValidSectionSubset, {
    message: "section_order must contain unique known section IDs",
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

  if (parsed.data.template_id !== templateId) {
    throw new Error(
      `Mismatched template layout response: expected '${templateId}', got '${parsed.data.template_id}'`
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
  signal?: AbortSignal,
  expectedSections?: readonly SectionId[]
): Promise<TemplateLayoutResponse> {
  const supported = expectedSections

  if (supported) {
    if (!isValidSectionOrder(sectionOrder, supported)) {
      throw new Error(
        `Invalid section order: must be an exact permutation of supported sections for template '${templateId}'`
      )
    }
  } else {
    if (!isValidSectionSubset(sectionOrder)) {
      throw new Error("Invalid section order: must contain unique valid section IDs")
    }
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

  if (parsed.data.template_id !== templateId) {
    throw new Error(
      `Mismatched template layout response after saving: expected '${templateId}', got '${parsed.data.template_id}'`
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
  section_order: z.array(SectionIdSchema).refine(isValidSectionSubset, {
    message: "section_order must contain unique known section IDs",
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
  signal?: AbortSignal,
  expectedSections?: readonly SectionId[]
): Promise<TemplatePreviewResponse> {
  if (sectionOrder !== undefined) {
    const supported = expectedSections

    if (supported) {
      if (!isValidSectionOrder(sectionOrder, supported)) {
        throw new Error(
          `Invalid section order: must be an exact permutation of supported sections for template '${templateId}'`
        )
      }
    } else {
      if (!isValidSectionSubset(sectionOrder)) {
        throw new Error("Invalid section order: must contain unique valid section IDs")
      }
    }
  }

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

  if (parsed.data.template_id !== templateId) {
    throw new Error(
      `Mismatched template preview response: expected '${templateId}', got '${parsed.data.template_id}'`
    )
  }

  return parsed.data
}

const outlinePreviewCache = new Map<string, TemplatePreviewResponse>()

export function getCachedOutlinePreview(key: string): TemplatePreviewResponse | undefined {
  return outlinePreviewCache.get(key)
}

export function setCachedOutlinePreview(key: string, value: TemplatePreviewResponse): void {
  if (outlinePreviewCache.size >= 24) {
    outlinePreviewCache.clear()
  }
  outlinePreviewCache.set(key, value)
}

export function clearPreviewCache(templateId?: string): void {
  if (templateId) {
    for (const key of outlinePreviewCache.keys()) {
      if (key.startsWith(`${templateId}:`)) {
        outlinePreviewCache.delete(key)
      }
    }
  } else {
    outlinePreviewCache.clear()
  }
}
