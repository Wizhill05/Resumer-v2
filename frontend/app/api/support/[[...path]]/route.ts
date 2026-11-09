import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { backendTokenForSession, internalToken } from "@/lib/jwt"

function isAllowedPath(path: string[]) {
  if (path.length === 0) return true
  if (path.length === 2 && path[0] === "push" && path[1] === "public-key") return true
  if (path.length === 1 && /^[0-9a-f-]{36}$/i.test(path[0])) return true
  if (path.length === 2 && /^[0-9a-f-]{36}$/i.test(path[0]) && path[1] === "messages") return true
  if (path.length === 2 && /^[0-9a-f-]{36}$/i.test(path[0]) && path[1] === "push") return true
  return false
}

async function handleSupport(
  req: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const { path = [] } = await params
  if (!isAllowedPath(path)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const session = await auth()
  const headers = new Headers()
  const contentType = req.headers.get("content-type")
  if (contentType) headers.set("Content-Type", contentType)
  if (session?.user?.email) {
    headers.set(
      "Authorization",
      `Bearer ${await backendTokenForSession(session)}`
    )
  }
  // Forward guest support cookie (strictly-necessary functional cookie)
  const cookieHeader = req.headers.get("cookie")
  if (cookieHeader) {
    const parts = cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.startsWith("resumer_support_key="))
    if (parts.length) headers.set("Cookie", parts.join("; "))
  }
  // Forward real client IP with internal token in separate header so user auth still works.
  const forwardedFor = req.headers.get("x-forwarded-for")
  const firstHop = forwardedFor?.split(",")[0]?.trim()
  if (firstHop) headers.set("X-Client-IP", firstHop)
  if (process.env.INTERNAL_API_SECRET) {
    try {
      const token = await internalToken()
      headers.set("X-Internal-Token", token)
    } catch {}
  }
  const query = new URLSearchParams()
  const accessToken = req.nextUrl.searchParams.get("access_token")
  if (accessToken) query.set("access_token", accessToken)
  const endpoint = req.nextUrl.searchParams.get("endpoint")
  if (endpoint) query.set("endpoint", endpoint)
  try {
    const response = await fetch(
      `${process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000"}/feedback/support${path.length ? `/${path.join("/")}` : ""}${query.size ? `?${query}` : ""}`,
      {
        method: req.method,
        headers,
        body: req.method !== "GET" && req.method !== "DELETE" ? await req.arrayBuffer() : undefined,
        cache: "no-store",
        redirect: "error"
      }
    )
    const respHeaders = new Headers()
    respHeaders.set("Content-Type", response.headers.get("Content-Type") || "application/json")
    respHeaders.set("Cache-Control", "no-store")
    const setCookies =
      typeof (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
        ? (response.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
        : []
    if (setCookies.length) {
      for (const c of setCookies) respHeaders.append("Set-Cookie", c)
    } else {
      const sc = response.headers.get("set-cookie")
      if (sc) respHeaders.set("Set-Cookie", sc)
    }
    return new NextResponse(await response.blob(), {
      status: response.status,
      headers: respHeaders
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
export const DELETE = handleSupport
