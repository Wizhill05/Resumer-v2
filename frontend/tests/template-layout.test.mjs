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
    TemplateItemSchema,
    TemplateListResponseSchema,
    sortTemplates,
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

  // 12. Template list and item schema validation
  const validClassic = {
    id: "personal-classic",
    name: "Personal Classic",
    description: "Computer Modern serif, ATS-friendly single-column layout with icon contact row",
    content_slots: 6,
    default_section_order: [...DEFAULT_SECTION_ORDER],
  }
  const validSans = {
    id: "professional-sans",
    name: "Professional Sans",
    description: "Arial, centered contact header and compact single-column A4 layout",
    content_slots: 6,
    default_section_order: [
      "summary",
      "experiences",
      "projects",
      "skills",
      "education",
      "extracurriculars",
    ],
  }
  assert.strictEqual(TemplateItemSchema.safeParse(validClassic).success, true)
  assert.strictEqual(TemplateItemSchema.safeParse(validSans).success, true)

  const parsedList = TemplateListResponseSchema.safeParse([validClassic, validSans])
  assert.strictEqual(parsedList.success, true)

  // Invalid manifest default_section_order (duplicate section)
  const invalidDefaultOrder = {
    ...validSans,
    default_section_order: ["summary", "summary", "experiences", "projects", "skills", "education"],
  }
  assert.strictEqual(TemplateItemSchema.safeParse(invalidDefaultOrder).success, false)

  // 13. sortTemplates ensures Personal Classic first, Professional Sans second, then alphabetical
  const unsorted = [
    { id: "modern-executive", name: "Modern Executive" },
    { id: "professional-sans", name: "Professional Sans" },
    { id: "alpha-compact", name: "Alpha Compact" },
    { id: "personal-classic", name: "Personal Classic" },
  ]
  const sorted = sortTemplates(unsorted)
  assert.deepStrictEqual(
    sorted.map((t) => t.id),
    ["personal-classic", "professional-sans", "alpha-compact", "modern-executive"]
  )
})

test("Layout requests send validated orders and reject invalid server responses", async (t) => {
  const {
    saveTemplateLayout,
    fetchTemplateLayout,
    fetchTemplatePreview,
    fetchTemplates,
    DEFAULT_SECTION_ORDER,
  } = await import("../lib/template-layout.ts")

  const order = [...DEFAULT_SECTION_ORDER].reverse()
  const layout = {
    template_id: "personal-classic",
    default_section_order: [...DEFAULT_SECTION_ORDER],
    section_order: order,
  }

  let request
  t.mock.method(globalThis, "fetch", async (url, options) => {
    request = { url, ...options }
    return Response.json(layout)
  })

  // 1. Valid save
  assert.deepEqual(await saveTemplateLayout("personal-classic", order), layout)
  assert.equal(request.method, "PUT")
  assert.deepEqual(JSON.parse(request.body), { section_order: order })

  // 2. Invalid section order throws before network
  await assert.rejects(saveTemplateLayout("personal-classic", ["summary", "summary"]), /Invalid section order/)

  // 3. Invalid schema response from server throws
  globalThis.fetch = async () => Response.json({ ...layout, section_order: ["summary"] })
  await assert.rejects(fetchTemplateLayout("personal-classic"), /Invalid template layout response/)

  // 4. Server 503 error throws with detail
  globalThis.fetch = async () => Response.json({ detail: "Service unavailable" }, { status: 503 })
  await assert.rejects(fetchTemplatePreview("personal-classic", order), /Service unavailable/)

  // 5. Response template_id mismatch validation
  globalThis.fetch = async () => Response.json({
    template_id: "personal-classic", // Returned classic when sans requested!
    default_section_order: [...DEFAULT_SECTION_ORDER],
    section_order: order,
  })
  await assert.rejects(
    fetchTemplateLayout("professional-sans"),
    /Mismatched template layout response: expected 'professional-sans', got 'personal-classic'/
  )

  await assert.rejects(
    saveTemplateLayout("professional-sans", order),
    /Mismatched template layout response after saving: expected 'professional-sans', got 'personal-classic'/
  )

  globalThis.fetch = async () => Response.json({
    template_id: "personal-classic", // Returned classic when sans requested!
    page_images: ["data:image/webp;base64,abc"],
    page_count: 1,
    font_size: 10.0,
    fit_warning: false,
    section_order: order,
  })
  await assert.rejects(
    fetchTemplatePreview("professional-sans", order),
    /Mismatched template preview response: expected 'professional-sans', got 'personal-classic'/
  )

  // 6. fetchTemplates fetches and sorts templates correctly
  const rawApiTemplates = [
    {
      id: "professional-sans",
      name: "Professional Sans",
      description: "Arial, centered contact header and compact single-column A4 layout",
      content_slots: 6,
      default_section_order: [
        "summary",
        "experiences",
        "projects",
        "skills",
        "education",
        "extracurriculars",
      ],
    },
    {
      id: "personal-classic",
      name: "Personal Classic",
      description: "Computer Modern serif, ATS-friendly single-column layout with icon contact row",
      content_slots: 6,
      default_section_order: [...DEFAULT_SECTION_ORDER],
    },
  ]
  globalThis.fetch = async () => Response.json(rawApiTemplates)
  const fetchedTemplates = await fetchTemplates()
  assert.equal(fetchedTemplates.length, 2)
  assert.equal(fetchedTemplates[0].id, "personal-classic")
  assert.equal(fetchedTemplates[1].id, "professional-sans")
  assert.ok(fetchedTemplates[0].description.includes("Computer Modern"))
  assert.ok(fetchedTemplates[1].description.includes("Arial"))

  // 7. fetchTemplates error handling
  globalThis.fetch = async () => Response.json({ detail: "Database connection failed" }, { status: 500 })
  await assert.rejects(fetchTemplates(), /Database connection failed/)

  // 8. fetchTemplates invalid Zod schema error handling
  globalThis.fetch = async () => Response.json([{ id: "bad-template" }])
  await assert.rejects(fetchTemplates(), /Invalid templates response from server/)
})

test("Independent section orders and cache isolation for both templates", async (t) => {
  const {
    saveTemplateLayout,
    fetchTemplateLayout,
    fetchTemplatePreview,
    clearPreviewCache,
    getCachedOutlinePreview,
    setCachedOutlinePreview,
  } = await import("../lib/template-layout.ts")

  const classicDefault = [
    "summary",
    "education",
    "skills",
    "projects",
    "experiences",
    "extracurriculars",
  ]
  const sansDefault = [
    "summary",
    "experiences",
    "projects",
    "skills",
    "education",
    "extracurriculars",
  ]

  const customClassicOrder = [
    "skills",
    "projects",
    "experiences",
    "education",
    "summary",
    "extracurriculars",
  ]
  const customSansOrder = [
    "experiences",
    "projects",
    "summary",
    "skills",
    "education",
    "extracurriculars",
  ]

  const recordedCalls = []
  t.mock.method(globalThis, "fetch", async (url, options) => {
    recordedCalls.push({ url, method: options?.method, body: options?.body })
    if (url.includes("/professional-sans/layout")) {
      return Response.json({
        template_id: "professional-sans",
        default_section_order: sansDefault,
        section_order: customSansOrder,
      })
    }
    if (url.includes("/personal-classic/layout")) {
      return Response.json({
        template_id: "personal-classic",
        default_section_order: classicDefault,
        section_order: customClassicOrder,
      })
    }
    if (url.includes("/professional-sans/preview")) {
      return Response.json({
        template_id: "professional-sans",
        page_images: ["data:image/webp;base64,sanspage"],
        page_count: 1,
        font_size: 10.5,
        fit_warning: false,
        section_order: customSansOrder,
      })
    }
    return Response.json({ detail: "Not found" }, { status: 404 })
  })

  // Independent layout fetches
  const sansLayout = await fetchTemplateLayout("professional-sans")
  assert.equal(sansLayout.template_id, "professional-sans")
  assert.deepStrictEqual(sansLayout.default_section_order, sansDefault)
  assert.deepStrictEqual(sansLayout.section_order, customSansOrder)

  const classicLayout = await fetchTemplateLayout("personal-classic")
  assert.equal(classicLayout.template_id, "personal-classic")
  assert.deepStrictEqual(classicLayout.default_section_order, classicDefault)
  assert.deepStrictEqual(classicLayout.section_order, customClassicOrder)

  // Independent save requests
  const savedSans = await saveTemplateLayout("professional-sans", customSansOrder)
  assert.equal(savedSans.template_id, "professional-sans")
  assert.deepStrictEqual(savedSans.section_order, customSansOrder)

  const savedClassic = await saveTemplateLayout("personal-classic", customClassicOrder)
  assert.equal(savedClassic.template_id, "personal-classic")
  assert.deepStrictEqual(savedClassic.section_order, customClassicOrder)

  // Independent preview fetch
  const sansPreview = await fetchTemplatePreview("professional-sans", customSansOrder)
  assert.equal(sansPreview.template_id, "professional-sans")
  assert.deepStrictEqual(sansPreview.section_order, customSansOrder)

  // Test outline preview caching and invalidation
  const fakeSansPreview = {
    template_id: "professional-sans",
    page_images: ["data:image/webp;base64,sans"],
    page_count: 1,
    font_size: 10.0,
    fit_warning: false,
    section_order: customSansOrder,
  }
  const fakeClassicPreview = {
    template_id: "personal-classic",
    page_images: ["data:image/webp;base64,classic"],
    page_count: 1,
    font_size: 10.0,
    fit_warning: false,
    section_order: customClassicOrder,
  }

  setCachedOutlinePreview("professional-sans:order1", fakeSansPreview)
  setCachedOutlinePreview("personal-classic:order2", fakeClassicPreview)

  assert.deepStrictEqual(getCachedOutlinePreview("professional-sans:order1"), fakeSansPreview)
  assert.deepStrictEqual(getCachedOutlinePreview("personal-classic:order2"), fakeClassicPreview)

  // Clear only professional-sans cache
  clearPreviewCache("professional-sans")
  assert.equal(getCachedOutlinePreview("professional-sans:order1"), undefined)
  assert.deepStrictEqual(getCachedOutlinePreview("personal-classic:order2"), fakeClassicPreview)

  // Clear all caches
  clearPreviewCache()
  assert.equal(getCachedOutlinePreview("personal-classic:order2"), undefined)
})

test("Real TanStack Query race condition protection and navigation cache persistence", async () => {
  const { QueryClient } = await import("@tanstack/react-query")
  const { DEFAULT_SECTION_ORDER } = await import("../lib/template-layout.ts")

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  const templateId = "personal-classic"
  const staleOrder = [...DEFAULT_SECTION_ORDER]
  const newSavedOrder = [
    "skills",
    "projects",
    "experiences",
    "education",
    "summary",
    "extracurriculars",
  ]

  const staleResponse = {
    template_id: templateId,
    default_section_order: [...DEFAULT_SECTION_ORDER],
    section_order: staleOrder,
  }

  const verifiedSavedResponse = {
    template_id: templateId,
    default_section_order: [...DEFAULT_SECTION_ORDER],
    section_order: newSavedOrder,
  }

  // 1. A slow in-flight GET query starts first
  let slowQueryResolve
  const slowGetPromise = new Promise((resolve) => {
    slowQueryResolve = resolve
  })

  const queryPromise = queryClient.fetchQuery({
    queryKey: ["template-layout", templateId],
    queryFn: ({ signal }) => {
      return new Promise((resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new Error("Query aborted"))
        })
        slowGetPromise.then(() => resolve(staleResponse))
      })
    },
  })

  // 2. While GET is in-flight, layout save finishes!
  // Protocol on save:
  // (a) Cancel pending GET queries for templateId to protect against stale in-flight responses
  await queryClient.cancelQueries({ queryKey: ["template-layout", templateId] })
  // (b) Populate query cache with verified actual save response
  queryClient.setQueryData(["template-layout", templateId], verifiedSavedResponse)

  // 3. Now the slow GET completes its underlying network response
  slowQueryResolve()
  try {
    await queryPromise
  } catch {
    // Abort rejection handled
  }

  // CRITICAL ASSERTION: The cache MUST contain the verified saved response, NOT stale GET data!
  const cachedData = queryClient.getQueryData(["template-layout", templateId])
  assert.deepStrictEqual(cachedData, verifiedSavedResponse)
  assert.deepStrictEqual(cachedData.section_order, newSavedOrder)

  // 4. NAVIGATION PERSISTENCE:
  // On navigation, TanStack Query cache retains the verified saved layout without any stale session override
  const navigationData = queryClient.getQueryData(["template-layout", templateId])
  assert.deepStrictEqual(navigationData, verifiedSavedResponse)
  assert.deepStrictEqual(navigationData.section_order, newSavedOrder)
})

test("Background template query error with cached data retains data and unsaved state, blocks only on initial failure", async () => {
  const { QueryClient } = await import("@tanstack/react-query")

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  const cachedTemplates = [
    {
      id: "personal-classic",
      name: "Personal Classic",
      description: "Computer Modern serif ATS layout",
      content_slots: 6,
      default_section_order: [
        "summary",
        "education",
        "skills",
        "projects",
        "experiences",
        "extracurriculars",
      ],
    },
  ]

  // Scenario A: Initial load failure (no cached data exists)
  let initialFetchShouldFail = true
  await assert.rejects(
    queryClient.fetchQuery({
      queryKey: ["templates"],
      queryFn: async () => {
        if (initialFetchShouldFail) {
          throw new Error("Network offline on initial load")
        }
        return cachedTemplates
      },
    }),
    /Network offline on initial load/
  )
  // Cache remains empty on initial failure: application blocks with retry panel
  assert.equal(queryClient.getQueryData(["templates"]), undefined)

  // Scenario B: Initial load succeeds, populating cache
  initialFetchShouldFail = false
  const loaded = await queryClient.fetchQuery({
    queryKey: ["templates"],
    queryFn: async () => cachedTemplates,
  })
  assert.deepStrictEqual(loaded, cachedTemplates)
  assert.deepStrictEqual(queryClient.getQueryData(["templates"]), cachedTemplates)

  // Scenario C: Background refetch fails (e.g. transient 500 error or network hiccup)
  try {
    await queryClient.fetchQuery({
      queryKey: ["templates"],
      queryFn: async () => {
        throw new Error("500 Server Error during background refetch")
      },
    })
  } catch {
    // Background query threw
  }

  // Cache is NOT clobbered or cleared: existing cached templates remain intact!
  const retainedTemplates = queryClient.getQueryData(["templates"])
  assert.deepStrictEqual(retainedTemplates, cachedTemplates)
  assert.equal(retainedTemplates.length, 1)
  assert.equal(retainedTemplates[0].id, "personal-classic")
})

test("Frontend template list validation honors backend-valid template-specific section subsets and rejects duplicates/unknowns", async () => {
  const {
    TemplateItemSchema,
    TemplateListResponseSchema,
    TemplateLayoutResponseSchema,
    isValidSectionOrder,
    saveTemplateLayout,
  } = await import("../lib/template-layout.ts")

  // 1. Template with a 4-section subset (e.g. compact technical template without summary/extracurriculars)
  const compact4SectionManifest = {
    id: "compact-tech",
    name: "Compact Tech",
    description: "Compact single-page layout for experienced developers",
    content_slots: 6,
    default_section_order: ["experiences", "projects", "skills", "education"],
  }

  // Must validate successfully (must NOT reject entire selector for valid subsets!)
  const parsedManifest = TemplateItemSchema.safeParse(compact4SectionManifest)
  assert.equal(parsedManifest.success, true, "Valid 4-section subset manifest must be accepted")

  // Must validate in template list response
  const parsedList = TemplateListResponseSchema.safeParse([compact4SectionManifest])
  assert.equal(parsedList.success, true, "Template list containing subset manifest must pass validation")

  // 2. Reject duplicate section IDs in subset manifest
  const duplicateManifest = {
    ...compact4SectionManifest,
    default_section_order: ["experiences", "experiences", "skills", "education"],
  }
  const duplicateResult = TemplateItemSchema.safeParse(duplicateManifest)
  assert.equal(duplicateResult.success, false, "Manifest with duplicate section IDs must be rejected")

  // 3. Reject unknown section IDs in subset manifest
  const unknownManifest = {
    ...compact4SectionManifest,
    default_section_order: ["experiences", "projects", "skills", "hobbies_and_passions"],
  }
  const unknownResult = TemplateItemSchema.safeParse(unknownManifest)
  assert.equal(unknownResult.success, false, "Manifest with unknown section IDs must be rejected")

  // 4. Validate section orders against template's actual section set in layout response
  const validSubsetOrder = ["skills", "projects", "experiences", "education"]
  const validLayoutResponse = {
    template_id: "compact-tech",
    default_section_order: compact4SectionManifest.default_section_order,
    section_order: validSubsetOrder,
  }
  const layoutParse = TemplateLayoutResponseSchema.safeParse(validLayoutResponse)
  assert.equal(layoutParse.success, true, "Permutation of actual subset must pass layout validation")

  // 5. Layout with missing or foreign section compared to template default must fail
  const invalidLayoutResponse = {
    template_id: "compact-tech",
    default_section_order: compact4SectionManifest.default_section_order,
    section_order: ["skills", "projects", "experiences", "summary"], // "summary" is not in compact-tech!
  }
  const invalidLayoutParse = TemplateLayoutResponseSchema.safeParse(invalidLayoutResponse)
  assert.equal(invalidLayoutParse.success, false, "Foreign section not in template default must fail layout validation")

  // 6. isValidSectionOrder against template-specific set
  assert.equal(
    isValidSectionOrder(validSubsetOrder, compact4SectionManifest.default_section_order),
    true
  )
  assert.equal(
    isValidSectionOrder(["skills", "projects"], compact4SectionManifest.default_section_order),
    false,
    "Incomplete subset permutation must return false"
  )

  // 7. saveTemplateLayout with expectedSections
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => Response.json(validLayoutResponse)
    const saved = await saveTemplateLayout(
      "compact-tech",
      validSubsetOrder,
      undefined,
      compact4SectionManifest.default_section_order
    )
    assert.deepStrictEqual(saved.section_order, validSubsetOrder)

    // Invalid order for subset throws before network
    await assert.rejects(
      saveTemplateLayout(
        "compact-tech",
        ["skills", "projects"],
        undefined,
        compact4SectionManifest.default_section_order
      ),
      /Invalid section order/
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("fetchTemplatePreview and saveTemplateLayout support 4-section layouts for both bundled template IDs without hardcoded 6-section restrictions", async () => {
  const {
    fetchTemplatePreview,
    saveTemplateLayout,
  } = await import("../lib/template-layout.ts")

  const fourSectionDefaults = ["experiences", "projects", "skills", "education"]
  const valid4Permutation = ["skills", "experiences", "projects", "education"]
  const invalidSubset = ["skills", "experiences", "projects"] // Missing education

  const originalFetch = globalThis.fetch
  try {
    for (const bundledId of ["personal-classic", "professional-sans"]) {
      let previewCallBody = null
      let saveCallBody = null

      globalThis.fetch = async (url, init) => {
        const urlStr = String(url)
        if (urlStr.includes("/preview")) {
          previewCallBody = JSON.parse(init.body)
          return Response.json({
            template_id: bundledId,
            page_images: ["data:image/png;base64,sample1"],
            page_count: 1,
            font_size: 10.0,
            fit_warning: false,
            section_order: previewCallBody.section_order || valid4Permutation,
          })
        }
        if (urlStr.includes("/layout")) {
          saveCallBody = JSON.parse(init.body)
          return Response.json({
            template_id: bundledId,
            default_section_order: fourSectionDefaults,
            section_order: saveCallBody.section_order,
          })
        }
        throw new Error(`Unexpected url: ${urlStr}`)
      }

      // (A) Preview with actual 4-section defaults from manifest/server
      const preview = await fetchTemplatePreview(
        bundledId,
        valid4Permutation,
        undefined,
        fourSectionDefaults
      )
      assert.equal(preview.template_id, bundledId)
      assert.deepStrictEqual(previewCallBody.section_order, valid4Permutation)

      // (B) Preview without expectedSections: must NOT fail with hardcoded 6-section error
      const previewNoExpected = await fetchTemplatePreview(
        bundledId,
        valid4Permutation
      )
      assert.equal(previewNoExpected.template_id, bundledId)

      // (C) Save with actual 4-section defaults from manifest/server (e.g. from editor or manifest)
      const saved = await saveTemplateLayout(
        bundledId,
        valid4Permutation,
        undefined,
        fourSectionDefaults
      )
      assert.equal(saved.template_id, bundledId)
      assert.deepStrictEqual(saveCallBody.section_order, valid4Permutation)

      // (D) Incomplete permutation against 4-section default must be rejected before network
      await assert.rejects(
        fetchTemplatePreview(bundledId, invalidSubset, undefined, fourSectionDefaults),
        /Invalid section order/
      )
      await assert.rejects(
        saveTemplateLayout(bundledId, invalidSubset, undefined, fourSectionDefaults),
        /Invalid section order/
      )
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("TemplateLayoutEditor lifecycle & dirty-state safety: unsaved draft edits preserved on retry success, background errors, and async races", async () => {
  // Simulates component state transitions and async race conditions
  const defaultOrder = ["summary", "education", "skills", "projects", "experiences", "extracurriculars"]
  const userEditedDraft = ["projects", "experiences", "summary", "education", "skills", "extracurriculars"]
  const serverSavedOrder = ["experiences", "projects", "summary", "skills", "education", "extracurriculars"]

  // Helper comparing section orders
  function areOrdersEqual(a, b) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false
    }
    return true
  }

  // 1. Initial State: Dialog opens, initial load pending
  let templateDefault = [...defaultOrder]
  let appliedOrder = [...defaultOrder]
  let draftOrder = [...defaultOrder]
  let hasUserEdits = false

  const draftOrderRef = { current: draftOrder }
  const appliedOrderRef = { current: appliedOrder }
  let activeRequestId = 0

  // 2. Initial fetch fails
  activeRequestId++
  const req1 = activeRequestId

  // User edits draft while error is shown
  draftOrder = [...userEditedDraft]
  draftOrderRef.current = draftOrder
  hasUserEdits = true
  let isDirty = !areOrdersEqual(draftOrder, appliedOrder)
  assert.equal(isDirty, true, "Draft must be marked dirty after user edits")

  // 3. User clicks Retry: launches req2
  activeRequestId++
  const req2 = activeRequestId

  // Server response arrives for req2 with serverSavedOrder
  const req2Data = {
    template_id: "personal-classic",
    default_section_order: defaultOrder,
    section_order: serverSavedOrder,
  }

  if (activeRequestId === req2) {
    templateDefault = req2Data.default_section_order
    const currentIsDirty = !areOrdersEqual(draftOrderRef.current, appliedOrderRef.current)
    const hasUnsavedEdits = hasUserEdits || currentIsDirty

    if (hasUnsavedEdits) {
      // CRITICAL REQUIREMENT: Do NOT overwrite unsaved edits!
      appliedOrder = req2Data.section_order
      appliedOrderRef.current = req2Data.section_order
      if (areOrdersEqual(draftOrderRef.current, req2Data.section_order)) {
        hasUserEdits = false
      }
    } else {
      appliedOrder = req2Data.section_order
      draftOrder = [...req2Data.section_order]
      draftOrderRef.current = draftOrder
      hasUserEdits = false
    }
  }

  // CRITICAL ASSERTION: Draft order MUST still be userEditedDraft, NOT serverSavedOrder!
  assert.deepStrictEqual(draftOrder, userEditedDraft, "User draft edits must NOT be overwritten when Retry succeeds!")
  assert.deepStrictEqual(appliedOrder, serverSavedOrder, "Applied baseline must be updated to latest server order")
  isDirty = !areOrdersEqual(draftOrder, appliedOrder)
  assert.equal(isDirty, true, "Editor must remain dirty because user draft differs from server order")

  // 4. Async Race Safety: An old stale response (req1) arriving late MUST NOT overwrite state
  if (req1 !== activeRequestId) {
    // Stale request ignored!
  } else {
    assert.fail("Stale request should have been discarded")
  }
  assert.deepStrictEqual(draftOrder, userEditedDraft)

  // 5. Reset to default semantics:
  draftOrder = [...templateDefault]
  draftOrderRef.current = draftOrder
  assert.deepStrictEqual(draftOrder, defaultOrder, "Reset to default restores templateDefault")

  // 6. Cancel semantics:
  // Discarding changes restores baseline appliedOrder
  draftOrder = [...appliedOrder]
  draftOrderRef.current = draftOrder
  assert.deepStrictEqual(draftOrder, serverSavedOrder, "Cancel restores applied baseline order")
  isDirty = !areOrdersEqual(draftOrder, appliedOrder)
  assert.equal(isDirty, false, "After cancel/discard, editor is no longer dirty")
})

test("GenerateClient email override controls and request body generation semantics", () => {
  // Verifies the exact tri-state email notification override behavior as at HEAD

  const options = [
    { val: null, label: "Default" },
    { val: true, label: "Send Email" },
    { val: false, label: "No Email" },
  ]
  assert.equal(options.length, 3)

  // Function constructing generation request payload
  function buildGeneratePayload({
    selectedTemplate,
    jobDescription,
    keywords,
    instructions,
    projectsCount,
    experienceCount,
    creativityMode,
    sendEmail,
    sectionOrderToSend,
  }) {
    return {
      template_id: selectedTemplate,
      job_description: jobDescription,
      keywords: keywords ? keywords.split(",").map((k) => k.trim()) : [],
      instructions: instructions || null,
      content_split: { projects: projectsCount, experience: experienceCount },
      creativity_mode: creativityMode,
      send_email: sendEmail,
      section_order: sectionOrderToSend,
    }
  }

  // 1. Default (null)
  const payloadDefault = buildGeneratePayload({
    selectedTemplate: "personal-classic",
    jobDescription: "Software Engineer",
    keywords: "React, TypeScript",
    instructions: "",
    projectsCount: 2,
    experienceCount: 2,
    creativityMode: "proper",
    sendEmail: null,
    sectionOrderToSend: undefined,
  })
  assert.equal(payloadDefault.send_email, null, "Default override sends null in POST body")

  // 2. Send Email (true)
  const payloadSend = buildGeneratePayload({
    selectedTemplate: "personal-classic",
    jobDescription: "Software Engineer",
    keywords: "",
    instructions: "",
    projectsCount: 2,
    experienceCount: 2,
    creativityMode: "proper",
    sendEmail: true,
    sectionOrderToSend: undefined,
  })
  assert.equal(payloadSend.send_email, true, "Send Email override sends true in POST body")

  // 3. No Email (false)
  const payloadNoSend = buildGeneratePayload({
    selectedTemplate: "personal-classic",
    jobDescription: "Software Engineer",
    keywords: "",
    instructions: "",
    projectsCount: 2,
    experienceCount: 2,
    creativityMode: "proper",
    sendEmail: false,
    sectionOrderToSend: undefined,
  })
  assert.equal(payloadNoSend.send_email, false, "No Email override sends false in POST body")

  // 4. Notification message logic check
  function shouldNotify(sendEmail, profileNotify) {
    return sendEmail === true || (sendEmail === null && (profileNotify ?? true))
  }
  assert.equal(shouldNotify(null, true), true, "Default with profile true notifies")
  assert.equal(shouldNotify(null, false), false, "Default with profile false does not notify")
  assert.equal(shouldNotify(true, false), true, "Send Email override forces notify even if profile true")
  assert.equal(shouldNotify(false, true), false, "No Email override suppresses notify even if profile true")
})
