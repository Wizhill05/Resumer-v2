import posthog from "posthog-js"

export const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
export const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com"

export function initPostHog() {
  if (typeof window === "undefined") return
  if (!POSTHOG_KEY) return

  if (!posthog.__loaded) {
    posthog.init(POSTHOG_KEY, {
      api_host: "/ingest",
      ui_host: POSTHOG_HOST,
      person_profiles: "identified_only", // Keeps costs low and avoids creating anonymous profiles for bots
      capture_pageview: false, // We manually capture with Next.js router to ensure accurate route & search params
      capture_pageleave: true, // Enables time on page / duration measurement
      autocapture: true, // Captures clicks, form interactions, scroll
      session_recording: {
        maskAllInputs: true, // Masks sensitive inputs
        maskInputOptions: {
          password: true,
          color: false,
          date: false,
          "datetime-local": false,
          email: true,
          month: false,
          number: false,
          range: false,
          search: false,
          tel: true,
          text: false,
          time: false,
          url: false,
          week: false,
        },
      },
    })
  }
}

export { posthog }
