import { auth } from "@/lib/auth"
import { signBackendToken } from "@/lib/jwt"
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
  const cleanBackendUrl = backendUrl.replace(/\/+$/, "")

  const rawClientId = typeof params.client_id === "string" ? params.client_id : "Client"
  const clientName = rawClientId.charAt(0).toUpperCase() + rawClientId.slice(1)
  const relativeCallbackUrl = `/oauth/authorize?${queryParams.toString()}&backend_url=${encodeURIComponent(cleanBackendUrl)}`

  // If user is logged into NextAuth on frontend
  if (session?.user?.email) {
    let provider = "oauth-session"
    let githubUsername: string | null = null
    let githubAccessToken: string | null = null

    if (session && typeof session === "object") {
      if ("githubUsername" in session && typeof session.githubUsername === "string") {
        githubUsername = session.githubUsername
      }
      if ("githubAccessToken" in session && typeof session.githubAccessToken === "string") {
        githubAccessToken = session.githubAccessToken
      }
      if ("token" in session && session.token && typeof session.token === "object" && "provider" in session.token && typeof session.token.provider === "string") {
        provider = session.token.provider
      }
    }

    const tokenPayload = {
      email: session.user.email,
      name: session.user.name ?? null,
      picture: session.user.image ?? null,
      provider,
      github_username: githubUsername,
      github_access_token: githubAccessToken,
    }
    const backendToken = await signBackendToken(tokenPayload)
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
