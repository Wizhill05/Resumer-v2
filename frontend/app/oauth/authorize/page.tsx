import { auth } from "@/lib/auth"
import { backendTokenForSession } from "@/lib/jwt"
import { redirect } from "next/navigation"
import { OAuthAuthorizeClient } from "./OAuthAuthorizeClient"

const DEFAULT_BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_INTERNAL_URL || "http://localhost:8000"

export default async function OAuthAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const session = await auth()

  // Format all incoming query parameters
  const queryParams = new URLSearchParams()
  let backendUrl = typeof params.backend_url === "string" ? params.backend_url : ""

  for (const [key, value] of Object.entries(params)) {
    if (key === "backend_url" || key === "token") continue
    if (typeof value === "string") {
      queryParams.set(key, value)
    } else if (Array.isArray(value)) {
      value.forEach((v) => queryParams.append(key, v))
    }
  }

  if (!backendUrl) {
    backendUrl = DEFAULT_BACKEND_URL
  }
  let cleanBackendUrl = backendUrl.replace(/\/+$/, "")
  if (
    !cleanBackendUrl.includes("localhost") &&
    !cleanBackendUrl.includes("127.0.0.1") &&
    cleanBackendUrl.startsWith("http://")
  ) {
    cleanBackendUrl = "https://" + cleanBackendUrl.slice(7)
  }
  const rawClientId = typeof params.client_id === "string" ? params.client_id : "Client"
  const clientName = rawClientId.charAt(0).toUpperCase() + rawClientId.slice(1)
  const relativeCallbackUrl = `/oauth/authorize?${queryParams.toString()}&backend_url=${encodeURIComponent(cleanBackendUrl)}`

  // If user is logged into NextAuth on frontend
  if (session?.user?.email) {
    const backendToken = await backendTokenForSession(session)
    queryParams.set("token", backendToken)
    redirect(`${cleanBackendUrl}/oauth/authorize?${queryParams.toString()}`)
  }

  // If unauthenticated, show styled login prompt
  return (
    <OAuthAuthorizeClient
      clientName={clientName}
      callbackUrl={relativeCallbackUrl}
    />
  )
}
