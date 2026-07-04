import { NextRequest, NextResponse } from "next/server"

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
    const setCookie = backendRes.headers.get("set-cookie")
    responseHeaders.set("Content-Type", contentType)
    if (contentDisp) responseHeaders.set("Content-Disposition", contentDisp)
    if (location) responseHeaders.set("Location", location)
    if (setCookie) responseHeaders.set("Set-Cookie", setCookie)

    const resData = await backendRes.blob()
    return new NextResponse(resData, { status: backendRes.status, headers: responseHeaders })
  } catch (err) {
    console.error("Guest Proxy Error:", err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: "Failed to connect to backend service" }, { status: 502 })
  }
}

export const GET = handleGuestProxy
export const POST = handleGuestProxy
