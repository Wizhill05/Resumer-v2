"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { posthog, ANALYTICS_ENABLED } from "@/lib/posthog"
import { useProfileCompleteness } from "@/components/profile/useProfileCompleteness"
import { useHistorySummary } from "@/components/useGenerationStats"

/**
 * Getting-started guide for signed-in users.
 *
 * Step completion is derived from real data (profile + history), so it is
 * correct on every device. The only stored bits (dismissed, one-time tips
 * seen) live on the user row via /account/onboarding.
 */

export type OnboardingTip = "result" | "profile_ready"
export type OnboardingState = { dismissed: boolean; seen: OnboardingTip[] }

export const ONBOARDING_KEY = ["account-onboarding"] as const

async function fetchOnboarding(): Promise<OnboardingState> {
  const res = await fetch("/api/backend/account/onboarding")
  if (!res.ok) throw new Error("Failed to load onboarding state")
  return res.json()
}

export function useOnboardingState() {
  return useQuery({ queryKey: ONBOARDING_KEY, queryFn: fetchOnboarding, staleTime: 60_000, retry: 1 })
}

export function useUpdateOnboarding() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (patch: { dismissed?: boolean; seen?: OnboardingTip[] }) => {
      const res = await fetch("/api/backend/account/onboarding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error("Failed to save onboarding state")
      return (await res.json()) as OnboardingState
    },
    // Optimistic: hide the card / tip immediately, reconcile with the server.
    onMutate: (patch) => {
      const prev = queryClient.getQueryData<OnboardingState>(ONBOARDING_KEY)
      if (prev) {
        queryClient.setQueryData<OnboardingState>(ONBOARDING_KEY, {
          dismissed: patch.dismissed ?? prev.dismissed,
          seen: Array.from(new Set([...prev.seen, ...(patch.seen ?? [])])),
        })
      }
      if (ANALYTICS_ENABLED) {
        if (patch.dismissed) posthog.capture("onboarding_dismissed")
        patch.seen?.forEach((tip) => posthog.capture("onboarding_tip_seen", { tip }))
      }
      return { prev }
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(ONBOARDING_KEY, ctx.prev)
    },
    onSuccess: (data) => queryClient.setQueryData(ONBOARDING_KEY, data),
  })
}

export type ReadinessGap = { field: string; message: string }
export type GenerationReadiness = { is_ready: boolean; missing: ReadinessGap[] }

/**
 * Server-side readiness (/profile/generation-ready): the same rules the
 * generation preflight enforces (link, 3+ skills, usable entries, a split that
 * fits). Keyed on the profile queries' version so it refreshes after saves.
 */
export function useGenerationReadiness(version: string, enabled = true) {
  return useQuery<GenerationReadiness>({
    queryKey: ["generation-ready", version],
    queryFn: async () => {
      const res = await fetch("/api/backend/profile/generation-ready")
      if (!res.ok) throw new Error("Failed to load readiness")
      return res.json()
    },
    enabled,
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  })
}

/** Readiness messages worth showing in a one-line hint (split issues are shown separately). */
export function readinessMessages(readiness: GenerationReadiness | undefined, limit = 2): string[] {
  return (readiness?.missing ?? []).filter((gap) => gap.field !== "content_split").slice(0, limit).map((gap) => gap.message)
}

export type OnboardingStepId = "name" | "profile" | "generate" | "open"

export type OnboardingStep = {
  id: OnboardingStepId
  title: string
  hint: string
  href: string
  cta: string
  done: boolean
}

export function useOnboardingSteps() {
  const completeness = useProfileCompleteness()
  const history = useHistorySummary()
  const state = useOnboardingState()
  const readiness = useGenerationReadiness(completeness.version, completeness.complete)

  const total = history.data?.total ?? 0
  const usableTotal = history.data?.usable_total ?? total
  const profileReady = completeness.complete && readiness.data?.is_ready === true
  const readinessHint = readinessMessages(readiness.data).join(" ")
  const seen = state.data?.seen ?? []
  const steps: OnboardingStep[] = [
    {
      id: "name",
      title: "Tell us your name",
      hint: "Used at the top of every résumé.",
      href: "/profile?tab=basic",
      cta: "Add name",
      done: completeness.hasName,
    },
    {
      id: "profile",
      title: "Fill your profile",
      hint: completeness.missing.length
        ? `Missing: ${completeness.missing.join(", ")}. Uploading an old résumé PDF fills it fast.`
        : readinessHint || "Almost there. Add a couple more projects or roles so a layout fits.",
      href: "/profile",
      cta: "Open profile",
      done: profileReady,
    },
    {
      id: "generate",
      title: "Generate your first résumé",
      hint: total > usableTotal && usableTotal === 0
        ? "Your last build failed. Try again, or report it from History."
        : "Paste a job post. Résumer tailors your profile to it.",
      href: "/dashboard/generate",
      cta: total > 0 ? "Try again" : "Start",
      done: usableTotal > 0,
    },
    {
      id: "open",
      title: "Open it from History",
      hint: "Preview, download the PDF, or edit the text.",
      href: "/dashboard/history",
      cta: "Open history",
      done: seen.includes("result"),
    },
  ]

  const isLoading =
    completeness.isLoading || history.isPending || state.isPending || (completeness.complete && readiness.isPending)
  const doneCount = steps.filter((step) => step.done).length
  const current = steps.find((step) => !step.done) ?? null

  return {
    isLoading,
    steps,
    current,
    doneCount,
    allDone: doneCount === steps.length,
    dismissed: state.data?.dismissed ?? false,
    seen,
    /** True while the guide still applies: loaded, not dismissed, not finished. */
    active: !isLoading && !state.isError && !(state.data?.dismissed ?? false) && doneCount < steps.length,
    completeness,
    readiness: readiness.data,
    profileReady,
  }
}
