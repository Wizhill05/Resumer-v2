import { NextRequest, NextResponse } from "next/server"
import { internalToken } from "@/lib/jwt"

const BACKEND_URL = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000"

async function handleGuestProxy(
  req: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const resolvedParams = await params
  const pathParts = resolvedParams.path ?? []
  const queryString = req.nextUrl.search
  const targetUrl = `${BACKEND_URL}/guest/${pathParts.join("/")}${queryString}`

  const headers = new Headers()
  req.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "host") headers.set(key, value)
  })

  // Forward the real client IP with the internal token, exactly like the
  // support proxy, so the backend can enforce per-IP abuse limits. Only
  // trusted when INTERNAL_API_SECRET is set; otherwise the backend treats
  // the request as having no trusted IP and skips IP limits.
  const vercelForwardedFor = req.headers.get("x-vercel-forwarded-for")?.trim()
  const realIp = req.headers.get("x-real-ip")?.trim()
  const forwardedFor = req.headers.get("x-forwarded-for")
  const firstHop = forwardedFor?.split(",")[0]?.trim()
  const clientIp = vercelForwardedFor || realIp || firstHop
  if (clientIp) headers.set("X-Client-IP", clientIp)
  if (process.env.INTERNAL_API_SECRET) {
    try {
      const token = await internalToken()
      headers.set("X-Internal-Token", token)
    } catch {}
  }

  try {
    const body = req.method !== "GET" && req.method !== "HEAD" ? await req.arrayBuffer() : undefined
    const backendRes = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
    })

    const responseHeaders = new Headers()
    const contentType = backendRes.headers.get("content-type") || "application/json"
    const contentDisp = backendRes.headers.get("content-disposition")
    const location = backendRes.headers.get("location")
    responseHeaders.set("Content-Type", contentType)
    if (contentDisp) responseHeaders.set("Content-Disposition", contentDisp)
    if (location) responseHeaders.set("Location", location)
    const setCookies =
      typeof (backendRes.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
        ? (backendRes.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
        : []
    if (setCookies.length) {
      for (const c of setCookies) responseHeaders.append("Set-Cookie", c)
    } else {
      const setCookie = backendRes.headers.get("set-cookie")
      if (setCookie) responseHeaders.set("Set-Cookie", setCookie)
    }

    const resData = await backendRes.blob()
    return new NextResponse(resData, { status: backendRes.status, headers: responseHeaders })
  } catch (err) {
    console.error("Guest Proxy Error:", err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: "Failed to connect to backend service" }, { status: 502 })
  }
}

export const GET = handleGuestProxy
export const POST = handleGuestProxy
