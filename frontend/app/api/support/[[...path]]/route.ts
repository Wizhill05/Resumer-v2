import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { signBackendToken } from "@/lib/jwt"
import { z } from "zod"

const sessionClaims = z.object({
  provider: z.string().optional(),
  githubUsername: z.string().optional(),
  githubAccessToken: z.string().optional(),
  token: z
    .object({
      provider: z.string().optional(),
      githubUsername: z.string().optional(),
      githubAccessToken: z.string().optional()
    })
    .optional()
})

async function handleSupport(
  req: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const { path = [] } = await params
  if (
    path.length > 2 ||
    (path[0] && !/^[0-9a-f-]{36}$/i.test(path[0])) ||
    (path[1] && path[1] !== "messages")
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const session = await auth()
  const headers = new Headers()
  const contentType = req.headers.get("content-type")
  if (contentType) headers.set("Content-Type", contentType)
  if (session?.user?.email) {
    const claims = sessionClaims.parse(session)
    headers.set(
      "Authorization",
      `Bearer ${await signBackendToken({ email: session.user.email, name: session.user.name, picture: session.user.image, provider: claims.provider ?? claims.token?.provider ?? "unknown", github_username: claims.githubUsername ?? claims.token?.githubUsername ?? null, github_access_token: claims.githubAccessToken ?? claims.token?.githubAccessToken ?? null })}`
    )
  }
  const query = new URLSearchParams()
  const accessToken = req.nextUrl.searchParams.get("access_token")
  if (accessToken) query.set("access_token", accessToken)
  try {
    const response = await fetch(
      `${process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000"}/feedback/support${path.length ? `/${path.join("/")}` : ""}${query.size ? `?${query}` : ""}`,
      {
        method: req.method,
        headers,
        body: req.method !== "GET" ? await req.arrayBuffer() : undefined,
        cache: "no-store",
        redirect: "error"
      }
    )
    return new NextResponse(await response.blob(), {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "application/json",
        "Cache-Control": "no-store"
      }
    })
  } catch {
    return NextResponse.json(
      { error: "Support is temporarily unavailable. Please try again." },
      { status: 502 }
    )
  }
}
export const GET = handleSupport
export const POST = handleSupport

export const PATCH = handleSupport
