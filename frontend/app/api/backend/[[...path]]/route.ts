import { NextRequest, NextResponse } from "next/server"
import { ACCOUNT_PENDING_DELETION } from "@/lib/account-deletion"
import { SESSION_COOKIE_NAME, auth } from "@/lib/auth"
import { backendTokenForSession } from "@/lib/jwt"

const BACKEND_URL = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000"

async function handleProxy(
  req: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const session = await auth()
  if (!session || !session.user || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Generate internal signed JWT for FastAPI backend
  const backendToken = await backendTokenForSession(session)

  // Construct target URL
  const resolvedParams = await params
  const pathParts = resolvedParams.path ?? []
  const queryString = req.nextUrl.search
  const targetUrl = `${BACKEND_URL}/${pathParts.join("/")}${queryString}`

  // Prepare headers
  const headers = new Headers()
  req.headers.forEach((value, key) => {
    // Skip host header to avoid SSL/proxy host issues
    if (key.toLowerCase() !== "host") {
      headers.set(key, value)
    }
  })
  headers.set("Authorization", `Bearer ${backendToken}`)

  try {
    const body = req.method !== "GET" && req.method !== "HEAD"
      ? await req.arrayBuffer()
      : undefined

    const backendRes = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      cache: "no-store",
    })

    // The account was scheduled for deletion (maybe from another device). The session
    // here can't restore it, only a fresh sign-in can, so drop the session cookie.
    if (backendRes.status === 401 && backendRes.headers.get("x-account-status") === "pending_deletion") {
      const detail = await backendRes
        .json()
        .then((d: { detail?: unknown }) => (typeof d.detail === "string" ? d.detail : null))
        .catch(() => null)
      const res = NextResponse.json(
        { error: ACCOUNT_PENDING_DELETION, detail: detail ?? "This account is scheduled for deletion." },
        { status: 401 },
      )
      for (const { name } of req.cookies.getAll()) {
        // Auth.js may split a large session into `<name>.0`, `<name>.1`, ...
        if (name === SESSION_COOKIE_NAME || name.startsWith(`${SESSION_COOKIE_NAME}.`)) {
          res.cookies.set(name, "", {
            path: "/",
            maxAge: 0,
            httpOnly: true,
            sameSite: "lax",
            secure: SESSION_COOKIE_NAME.startsWith("__Secure-"),
          })
        }
      }
      return res
    }

    const contentType = backendRes.headers.get("content-type") || "application/json"
    const contentDisp = backendRes.headers.get("content-disposition")

    const responseHeaders = new Headers()
    responseHeaders.set("Content-Type", contentType)
    if (contentDisp) {
      responseHeaders.set("Content-Disposition", contentDisp)
    }

    if (contentType.includes("text/event-stream")) {
      responseHeaders.set("Cache-Control", "no-cache")
      responseHeaders.set("Connection", "keep-alive")
      return new NextResponse(backendRes.body, {
        status: backendRes.status,
        headers: responseHeaders,
      })
    }

    const resData = await backendRes.blob()
    return new NextResponse(resData, {
      status: backendRes.status,
      headers: responseHeaders,
    })
  } catch (err) {
    console.error("BFF Proxy Error:", err instanceof Error ? err.message : String(err))
    return NextResponse.json(
      { error: "Failed to connect to backend service" },
      { status: 502 }
    )
  }
}

export const GET = handleProxy
export const POST = handleProxy
export const PUT = handleProxy
export const PATCH = handleProxy
export const DELETE = handleProxy
