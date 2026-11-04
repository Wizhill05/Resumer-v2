"use client"

import { useEffect, useRef, Suspense } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { posthog, ANALYTICS_ENABLED, analyticsUrl, privateAnalyticsPage } from "@/lib/posthog"

function PostHogPageView() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { status } = useSession()
  const lastPage = useRef<string | null>(null)
  const lastSignedInPage = useRef<string | null>(null)

  useEffect(() => {
    if (!ANALYTICS_ENABLED || !pathname) return

    posthog.set_config({ disable_session_recording: privateAnalyticsPage(pathname) })

    let url = window.origin + pathname
    if (searchParams && searchParams.toString()) {
      url = `${url}?${searchParams.toString()}`
    }

    const page = analyticsUrl(url)
    if (lastPage.current !== page) {
      lastPage.current = page
      posthog.capture("$pageview", {
        $current_url: page,
        authentication_status: status,
        is_signed_in: status === "loading" ? undefined : status === "authenticated",
      })
    }
    if (status === "authenticated" && lastSignedInPage.current !== page) {
      lastSignedInPage.current = page
      posthog.capture("signed_in_visit", { $current_url: page, is_signed_in: true })
    } else if (status === "unauthenticated") {
      lastSignedInPage.current = null
    }

  }, [pathname, searchParams, status])

  return null
}

function PostHogUserSync() {
  const { data: session, status } = useSession()

  useEffect(() => {
    if (!ANALYTICS_ENABLED) return

    if (status === "authenticated" && session?.user) {
      const user = session.user
      const identity = user.email?.trim().toLowerCase() || user.id
      if (identity) {
        posthog.identify(identity)
      }
      posthog.register({ is_signed_in: true })
    } else if (status === "unauthenticated" && posthog.get_property("$user_id")) {
      posthog.reset()
    }
    if (status === "unauthenticated") posthog.register({ is_signed_in: false })
  }, [session, status])

  return null
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PostHogUserSync />
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      {children}
    </>
  )
}
