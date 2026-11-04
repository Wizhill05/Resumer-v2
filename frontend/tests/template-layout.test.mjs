import test from "node:test"
import assert from "node:assert/strict"

test("Runtime validation of section orders and permutation logic", async () => {
  const {
    DEFAULT_SECTION_ORDER,
    isValidSectionOrder,
    SECTION_METADATA,
    FIXED_HEADER_METADATA,
    TemplateLayoutResponseSchema,
    TemplateLayoutPutBodySchema,
    TemplatePreviewResponseSchema,
    fetchTemplatePreview,
  } = await import("../lib/template-layout.ts")

  // 1. Default sequence
  assert.deepStrictEqual(DEFAULT_SECTION_ORDER, [
    "summary",
    "education",
    "skills",
    "projects",
    "experiences",
    "extracurriculars",
  ])

  // 2. Exact permutation passes
  assert.strictEqual(isValidSectionOrder(DEFAULT_SECTION_ORDER), true)
  assert.strictEqual(
    isValidSectionOrder([
      "experiences",
      "projects",
      "skills",
      "summary",
      "education",
      "extracurriculars",
    ]),
    true
  )

  // 3. Duplicates fail
  assert.strictEqual(
    isValidSectionOrder([
      "summary",
      "summary",
      "skills",
      "projects",
      "experiences",
      "extracurriculars",
    ]),
    false
  )

  // 4. Missing item fails
  assert.strictEqual(
    isValidSectionOrder(["summary", "education", "skills", "projects", "experiences"]),
    false
  )

  // 5. Extra item fails
  assert.strictEqual(
    isValidSectionOrder([
      "summary",
      "education",
      "skills",
      "projects",
      "experiences",
      "extracurriculars",
      "extra",
    ]),
    false
  )

  // 6. Unknown item fails
  assert.strictEqual(
    isValidSectionOrder([
      "summary",
      "education",
      "skills",
      "projects",
      "experiences",
      "unknown",
    ]),
    false
  )

  // 7. Non-arrays fail
  assert.strictEqual(isValidSectionOrder(null), false)
  assert.strictEqual(isValidSectionOrder(undefined), false)
  assert.strictEqual(isValidSectionOrder("summary"), false)
  assert.strictEqual(isValidSectionOrder({ length: 6 }), false)

  // 8. Metadata covers all 6 sections with human-readable labels
  for (const id of DEFAULT_SECTION_ORDER) {
    const meta = SECTION_METADATA[id]
    assert.ok(meta, `Metadata exists for ${id}`)
    assert.ok(meta.label && meta.label.length > 0, `Label defined for ${id}`)
    assert.ok(meta.shortDescription && meta.shortDescription.length > 0, `Description defined for ${id}`)
  }

  // 9. Fixed header metadata
  assert.ok(FIXED_HEADER_METADATA.label.includes("contact details"))

  // 10. Zod schemas validate exact responses
  const validBackendResponse = {
    template_id: "personal-classic",
    default_section_order: [...DEFAULT_SECTION_ORDER],
    section_order: [
      "skills",
      "experiences",
      "projects",
      "education",
      "summary",
      "extracurriculars",
    ],
  }
  const parsedResponse = TemplateLayoutResponseSchema.safeParse(validBackendResponse)
  assert.strictEqual(parsedResponse.success, true)

  const invalidBackendResponse = {
    template_id: "personal-classic",
    default_section_order: [...DEFAULT_SECTION_ORDER],
    section_order: ["skills", "experiences"], // Incomplete
  }
  assert.strictEqual(TemplateLayoutResponseSchema.safeParse(invalidBackendResponse).success, false)

  const validPut = { section_order: [...DEFAULT_SECTION_ORDER] }
  assert.strictEqual(TemplateLayoutPutBodySchema.safeParse(validPut).success, true)

  // 11. Template preview response schema
  const validPreviewResponse = {
    template_id: "personal-classic",
    page_images: ["data:image/webp;base64,samplepage1"],
    page_count: 1,
    font_size: 11.15,
    fit_warning: false,
    section_order: [...DEFAULT_SECTION_ORDER],
  }
  assert.strictEqual(TemplatePreviewResponseSchema.safeParse(validPreviewResponse).success, true)

  const invalidPreviewResponse = {
    template_id: "personal-classic",
    page_images: ["data:image/webp;base64,samplepage1"],
    page_count: 1,
    font_size: 11.15,
    fit_warning: false,
    section_order: ["summary", "summary"], // Duplicates invalid
  }
  assert.strictEqual(TemplatePreviewResponseSchema.safeParse(invalidPreviewResponse).success, false)
})


test("Layout requests send validated orders and reject invalid server responses", async (t) => {
  const { saveTemplateLayout, fetchTemplateLayout, fetchTemplatePreview, DEFAULT_SECTION_ORDER } = await import("../lib/template-layout.ts")
  const order = [...DEFAULT_SECTION_ORDER].reverse()
  const layout = { template_id: "personal-classic", default_section_order: [...DEFAULT_SECTION_ORDER], section_order: order }
  let request
  t.mock.method(globalThis, "fetch", async (url, options) => {
    request = { url, ...options }
    return Response.json(layout)
  })
  assert.deepEqual(await saveTemplateLayout("personal-classic", order), layout)
  assert.equal(request.method, "PUT")
  assert.deepEqual(JSON.parse(request.body), { section_order: order })
  await assert.rejects(saveTemplateLayout("personal-classic", ["summary"]), /Invalid section order/)
  globalThis.fetch = async () => Response.json({ ...layout, section_order: ["summary"] })
  await assert.rejects(fetchTemplateLayout("personal-classic"), /Invalid template layout response/)
  globalThis.fetch = async () => Response.json({ detail: "Service unavailable" }, { status: 503 })
  await assert.rejects(fetchTemplatePreview("personal-classic", order), /Service unavailable/)
})
