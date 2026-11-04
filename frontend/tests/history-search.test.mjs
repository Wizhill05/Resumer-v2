import test from "node:test"
import assert from "node:assert/strict"

test("filterHistoryRuns case-insensitive trimmed substring filtering", async () => {
  const { filterHistoryRuns, HISTORY_PAGE_SIZE } = await import("../lib/history.ts")

  assert.strictEqual(HISTORY_PAGE_SIZE, 12, "PAGE_SIZE should default to 12")

  const mockRuns = [
    {
      id: "run-1",
      company: "Google LLC",
      job_title: "Senior Staff Software Engineer",
      status: "completed",
      created_at: "2026-01-01T00:00:00Z",
      template_id: "classic",
      model_used: "gpt-4",
      job_description: "Build distributed systems",
    },
    {
      id: "run-2",
      company: "Stripe",
      job_title: "Infrastructure Lead",
      status: "completed",
      created_at: "2026-01-02T00:00:00Z",
      template_id: "modern",
      model_used: "gpt-4",
      job_description: "Scale payment APIs",
    },
    {
      id: "run-3",
      company: "Meta Platforms",
      job_title: "Product Manager",
      status: "completed",
      created_at: "2026-01-03T00:00:00Z",
      template_id: "minimal",
      model_used: "gpt-4",
      job_description: "Lead product roadmap",
    },
    {
      id: "run-4",
      company: undefined,
      job_title: "Frontend Developer",
      status: "completed",
      created_at: "2026-01-04T00:00:00Z",
      template_id: "classic",
      model_used: "gpt-4",
      job_description: "React and Next.js frontend",
    },
    {
      id: "run-5",
      company: "Amazon Web Services",
      job_title: undefined,
      status: "completed",
      created_at: "2026-01-05T00:00:00Z",
      template_id: "compact",
      model_used: "gpt-4",
      job_description: "Cloud solutions architecture",
    },
    {
      id: "run-6",
      company: undefined,
      job_title: undefined,
      status: "failed",
      created_at: "2026-01-06T00:00:00Z",
      template_id: "classic",
      model_used: "gpt-4",
      job_description: "Unknown role",
    },
  ]

  // 1. Empty or whitespace-only queries return all runs
  assert.strictEqual(filterHistoryRuns(mockRuns, "").length, 6)
  assert.strictEqual(filterHistoryRuns(mockRuns, "   ").length, 6)
  assert.strictEqual(filterHistoryRuns(mockRuns, "\t\n").length, 6)

  // 2. Filter by company (case-insensitive and trimmed)
  const googleResults = filterHistoryRuns(mockRuns, "  google  ")
  assert.strictEqual(googleResults.length, 1)
  assert.strictEqual(googleResults[0].id, "run-1")

  const stripeUpper = filterHistoryRuns(mockRuns, "STRIPE")
  assert.strictEqual(stripeUpper.length, 1)
  assert.strictEqual(stripeUpper[0].id, "run-2")

  const metaSubstr = filterHistoryRuns(mockRuns, "meta")
  assert.strictEqual(metaSubstr.length, 1)
  assert.strictEqual(metaSubstr[0].id, "run-3")

  // 3. Filter by job title (case-insensitive and substring)
  const engineerResults = filterHistoryRuns(mockRuns, "engineer")
  assert.strictEqual(engineerResults.length, 1)
  assert.strictEqual(engineerResults[0].id, "run-1")

  const leadResults = filterHistoryRuns(mockRuns, "LEAD")
  assert.strictEqual(leadResults.length, 1)
  assert.strictEqual(leadResults[0].id, "run-2")

  const frontendResults = filterHistoryRuns(mockRuns, "front")
  assert.strictEqual(frontendResults.length, 1)
  assert.strictEqual(frontendResults[0].id, "run-4")

  // 4. Undefined handling: does not crash when company or job_title is missing
  const amazonResults = filterHistoryRuns(mockRuns, "amazon")
  assert.strictEqual(amazonResults.length, 1)
  assert.strictEqual(amazonResults[0].id, "run-5")

  // 5. Query matching neither returns empty array
  const noMatches = filterHistoryRuns(mockRuns, "nonexistent company or role xyz")
  assert.deepStrictEqual(noMatches, [])

  // 6. Substring match matching multiple entries across company and job_title
  const subInResults = filterHistoryRuns(mockRuns, "in")
  // "Senior Staff Software Engineer" (title contains "in")
  // "Infrastructure Lead" (title contains "In")
  // "Frontend Developer" (company or title? No)
  // Let's verify:
  assert.ok(subInResults.some((r) => r.id === "run-1"))
  assert.ok(subInResults.some((r) => r.id === "run-2"))
})

