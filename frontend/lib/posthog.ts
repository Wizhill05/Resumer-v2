import posthog from "posthog-js"

export const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
export const ANALYTICS_ENVIRONMENT = process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV
export const ANALYTICS_ENABLED = !!POSTHOG_KEY && ANALYTICS_ENVIRONMENT === "production"
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com"
const uiHost = host.replace(".i.posthog.com", ".posthog.com")
const campaignParameters = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"])

export function analyticsUrl(value: string): string {
  try {
    const url = new URL(value)
    for (const key of [...url.searchParams.keys()]) {
      if (!campaignParameters.has(key)) url.searchParams.delete(key)
    }
    url.hash = ""
    return url.toString()
  } catch {
    return ""
  }
}

export function privateAnalyticsPage(pathname: string): boolean {
  return /^\/(support|admin|dashboard|try|profile|onboarding|oauth|account)(\/|$)/.test(pathname)
}

function sanitizeAnalyticsProperties(properties: object) {
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value === "string" && /^https?:\/\//.test(value)) {
      Object.assign(properties, { [key]: analyticsUrl(value) })
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      sanitizeAnalyticsProperties(value)
    }
  }
}

export function initPostHog() {
  if (typeof window === "undefined" || !ANALYTICS_ENABLED || !POSTHOG_KEY || posthog.__loaded) return
  posthog.init(POSTHOG_KEY, {
    api_host: "/ingest",
    ui_host: uiHost,
    person_profiles: "identified_only",
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    disable_session_recording: privateAnalyticsPage(window.location.pathname),
    before_send: (event) => {
      if (!event || window.location.pathname.startsWith("/support") || JSON.stringify(event).includes("access_token")) return null
      sanitizeAnalyticsProperties(event.properties)
      event.properties.environment = ANALYTICS_ENVIRONMENT
      return event
    },
    enable_recording_console_log: false,
    session_recording: {
      recordHeaders: false,
      recordBody: false,
      maskAllInputs: true,
      maskTextSelector: "*",
      maskAllElementAttributes: true,
    },
  })
}

export function generationAnalyticsContext() {
  if (!ANALYTICS_ENABLED || !posthog.__loaded || posthog.has_opted_out_capturing()) return undefined
  return { distinct_id: posthog.get_distinct_id(), session_id: posthog.get_session_id() }
}

export function captureDownload(runId: string, source: "editor" | "history" | "remake" | "guest") {
  if (!ANALYTICS_ENABLED) return
  posthog.capture("resume_download_clicked", { run_id: runId, source, is_guest: source === "guest" })
}

export { posthog }
