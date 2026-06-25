import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { signBackendToken } from "@/lib/jwt"

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
  const tokenPayload = {
    email: session.user.email,
    name: session.user.name,
    picture: session.user.image,
    provider: (session as { token?: { provider?: string } }).token?.provider ?? "unknown",
  }
  const backendToken = await signBackendToken(tokenPayload)

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
      ? await req.blob() 
      : undefined

    const backendRes = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      cache: "no-store",
    })

    const resData = await backendRes.blob()
    const contentType = backendRes.headers.get("content-type") || "application/json"

    return new NextResponse(resData, {
      status: backendRes.status,
      headers: {
        "Content-Type": contentType,
      },
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
export const DELETE = handleProxy
