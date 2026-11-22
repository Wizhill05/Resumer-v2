import { auth } from "@/lib/auth"
import { oauthHandoffToken } from "@/lib/jwt"
import { redirect } from "next/navigation"
import { OAuthAuthorizeClient } from "./OAuthAuthorizeClient"

const DEFAULT_BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_INTERNAL_URL || "http://localhost:8000"

function originOf(value: string | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

/**
 * Backends this bridge may send a sign-in token to. `backend_url` comes from the query string,
 * so anything not configured here is ignored (otherwise any link could make a signed-in user's
 * browser hand their token to another host).
 */
const ALLOWED_BACKEND_ORIGINS = new Set(
  [
    process.env.NEXT_PUBLIC_BACKEND_URL,
    process.env.BACKEND_INTERNAL_URL,
    process.env.NEXT_PUBLIC_MCP_URL,
    process.env.OAUTH_ALLOWED_BACKEND_ORIGINS?.split(",").map((s) => s.trim()),
    // Production API (also the default MCP URL on /agent).
    "https://api.resumer.buzz",
  ]
    .flat()
    .map((v) => originOf(v ?? undefined))
    .filter((v): v is string => !!v),
)

function trustedBackendUrl(requested: string): string {
  const origin = originOf(requested)
  const fallback = DEFAULT_BACKEND_URL.replace(/\/+$/, "")
  if (!origin) return fallback
  if (ALLOWED_BACKEND_ORIGINS.has(origin)) return origin
  // Local development: any loopback backend is fine.
  if (process.env.NODE_ENV !== "production" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin
  return fallback
}

export default async function OAuthAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const session = await auth()

  // Format all incoming query parameters
  const queryParams = new URLSearchParams()
  const backendUrl = typeof params.backend_url === "string" ? params.backend_url : ""

  for (const [key, value] of Object.entries(params)) {
    if (key === "backend_url" || key === "token") continue
    if (typeof value === "string") {
      queryParams.set(key, value)
    } else if (Array.isArray(value)) {
      value.forEach((v) => queryParams.append(key, v))
    }
  }

  const cleanBackendUrl = trustedBackendUrl(backendUrl)
  const rawClientId = typeof params.client_id === "string" ? params.client_id : "Client"
  const clientName = rawClientId.charAt(0).toUpperCase() + rawClientId.slice(1)
  const relativeCallbackUrl = `/oauth/authorize?${queryParams.toString()}&backend_url=${encodeURIComponent(cleanBackendUrl)}`

  // If user is logged into NextAuth on frontend
  if (session?.user?.email) {
    queryParams.set("token", await oauthHandoffToken(session))
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
