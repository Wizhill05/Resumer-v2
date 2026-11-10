"use client"

import { clearGuestDraft, loadGuestDraft, saveGuestLatestRun } from "@/lib/guest-storage"
import type { GuestDraft, GuestProfile } from "@/lib/guest-types"

export type GuestImportResult = {
  /** Guest résumés moved into the account's history. */
  claimed: number
  /** Whether any trial details were copied into the account. */
  imported: boolean
  /** False when some request failed; the draft is kept so it can retry. */
  ok: boolean
}

const PROFILE_KEYS: (keyof GuestProfile)[] = [
  "full_name", "email", "phone", "location", "linkedin_url",
  "github_url", "portfolio_url", "subtitle", "summary", "skills",
]

type Section = "experiences" | "projects" | "education" | "extracurriculars"
const SECTIONS: Section[] = ["experiences", "projects", "education", "extracurriculars"]

const isBlank = (v: unknown) =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0)

export function hasGuestDraft(draft: GuestDraft = loadGuestDraft()): boolean {
  return (
    Object.values(draft.profile).some((v) => !isBlank(v)) ||
    SECTIONS.some((s) => draft[s].length > 0)
  )
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) throw new Error(`Failed to load ${url}`)
  return res.json()
}

async function run(): Promise<GuestImportResult> {
  // Move this browser's trial résumés into the account (idempotent, cookie-based).
  let claimed = 0
  try {
    const res = await fetch("/api/backend/generate/claim-guest", { method: "POST" })
    if (res.ok) claimed = ((await res.json()) as { claimed?: number }).claimed ?? 0
  } catch {}
  if (claimed > 0) saveGuestLatestRun(null)

  const draft = loadGuestDraft()
  if (!hasGuestDraft(draft)) return { claimed, imported: false, ok: true }

  const [profile, ...lists] = await Promise.all([
    getJson<Record<string, unknown>>("/api/backend/profile"),
    ...SECTIONS.map((s) => getJson<unknown[]>(`/api/backend/profile/${s}`)),
  ])

  const jobs: Promise<Response>[] = []

  // Fill only the profile fields the account doesn't have yet; never overwrite.
  const patch: Record<string, unknown> = {}
  for (const key of PROFILE_KEYS) {
    const value = draft.profile[key]
    if (!isBlank(value) && isBlank(profile[key])) patch[key] = value
  }
  if (Object.keys(patch).length) {
    jobs.push(fetch("/api/backend/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }))
  }

  // Copy a whole section only into an empty one, so nothing gets duplicated.
  SECTIONS.forEach((section, i) => {
    if (lists[i].length > 0) return
    draft[section].forEach((item, order) => {
      jobs.push(fetch(`/api/backend/profile/${section}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...item, sort_order: item.sort_order ?? order }),
      }))
    })
  })

  const results = await Promise.all(jobs)
  const ok = results.every((res) => res.ok)
  // Done (or nothing left to copy): drop the trial draft so it never re-imports.
  if (ok) clearGuestDraft()
  return { claimed, imported: jobs.length > 0, ok }
}

let inFlight: Promise<GuestImportResult> | null = null

/**
 * Bring a guest's /try work into the signed-in account: claims their trial
 * résumés and copies their details into empty profile fields and sections.
 * Safe to call more than once; concurrent calls share one run.
 */
export function importGuestIntoAccount(): Promise<GuestImportResult> {
  inFlight ??= run().finally(() => { inFlight = null })
  return inFlight
}
