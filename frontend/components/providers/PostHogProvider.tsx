"use client"

import { useEffect, Suspense } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { initPostHog, posthog, POSTHOG_KEY } from "@/lib/posthog"

function PostHogPageView() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!POSTHOG_KEY || !pathname) return

    let url = window.origin + pathname
    if (searchParams && searchParams.toString()) {
      url = `${url}?${searchParams.toString()}`
    }

    posthog.capture("$pageview", {
      $current_url: url,
    })
  }, [pathname, searchParams])

  return null
}

function PostHogUserSync() {
  const { data: session, status } = useSession()

  useEffect(() => {
    if (!POSTHOG_KEY) return

    if (status === "authenticated" && session?.user) {
      const user = session.user
      if (user.id || user.email) {
        posthog.identify(user.id || (user.email as string), {
          email: user.email,
          name: user.name,
        })
      }
    } else if (status === "unauthenticated") {
      posthog.reset()
    }
  }, [session, status])

  return null
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initPostHog()
  }, [])

  return (
    <>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      <PostHogUserSync />
      {children}
    </>
  )
}
