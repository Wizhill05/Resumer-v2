"use server"

import { cookies, headers as nextHeaders } from "next/headers"

import { signIn, signOut } from "@/lib/auth"
import { internalToken } from "@/lib/jwt"
import { AUTH_RETURN_COOKIE } from "@/lib/auth-errors"

async function backendHeaders(): Promise<Record<string, string>> {
  const extra: Record<string, string> = {}
  if (!process.env.INTERNAL_API_SECRET) {
    // Not fatal here (callers report their own failure), but the backend rejects the
    // email sign-up endpoints without an internal token, so sign-up cannot work.
    console.error(
      "INTERNAL_API_SECRET is not set: the backend will reject email sign-up requests (401). Set it on the frontend and backend."
    )
    return extra
  }
  try {
    const token = await internalToken()
    extra.Authorization = `Bearer ${token}`
    const hdrs = await nextHeaders()
    const vercelForwardedFor = hdrs.get("x-vercel-forwarded-for")?.trim()
    const realIp = hdrs.get("x-real-ip")?.trim()
    const forwardedFor = hdrs.get("x-forwarded-for")
    const firstHop = forwardedFor?.split(",")[0]?.trim()
    const clientIp = vercelForwardedFor || realIp || firstHop
    if (clientIp) {
      extra["X-Client-IP"] = clientIp
    }
  } catch (err) {
    console.error("backendHeaders: failed to build internal request headers:", err)
  }
  return extra
}

function callbackUrl(formData?: FormData) {
  const raw = formData?.get("callbackUrl")
  return typeof raw === "string" && raw.startsWith("/") ? raw : "/dashboard"
}

// Remember where an OAuth sign-in started so a failed or cancelled attempt
// lands back there (see app/auth/error/route.ts) instead of on the homepage.
async function rememberAuthReturn(formData?: FormData) {
  const raw = formData?.get("returnTo")
  const jar = await cookies()
  // Validated again (same-origin, no escapes) when it's read in /auth/error.
  if (typeof raw === "string" && raw.startsWith("/") && raw.length <= 512) {
    jar.set(AUTH_RETURN_COOKIE, raw, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 15 * 60, secure: process.env.NODE_ENV === "production" })
  } else {
    jar.delete(AUTH_RETURN_COOKIE)
  }
}

export async function signInGithub(formData?: FormData) {
  await rememberAuthReturn(formData)
  await signIn("github", { redirectTo: callbackUrl(formData) })
}

export async function signInGoogle(formData?: FormData) {
  await rememberAuthReturn(formData)
  await signIn("google", { redirectTo: callbackUrl(formData) })
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" })
}

export async function precheckEmailLoginAction({
  email,
  password,
}: {
  email: string
  password: string
}) {
  const backendUrl =
    process.env.BACKEND_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "http://localhost:8000"

  try {
    const res = await fetch(`${backendUrl}/auth/email/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { success: false, error: data.detail || "Authentication failed." }
    }
    return { success: true, user: data }
  } catch (err) {
    console.error("precheckEmailLoginAction error:", err)
    return { success: false, error: "Failed to connect to authentication server." }
  }
}

export async function startEmailRegistrationAction({
  email,
  password,
  name,
}: {
  email: string
  password: string
  name: string
}) {
  const backendUrl =
    process.env.BACKEND_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "http://localhost:8000"

  try {
    const res = await fetch(`${backendUrl}/auth/email/register/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await backendHeaders()) },
      body: JSON.stringify({ email, password, name }),
      cache: "no-store",
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { success: false, error: data.detail || "Registration failed." }
    }
    return {
      success: true,
      email: typeof data.email === "string" ? data.email : email,
      resendAfter: typeof data.resend_after === "number" ? data.resend_after : 60,
    }
  } catch (err) {
    console.error("startEmailRegistrationAction error:", err)
    return { success: false, error: "Failed to connect to authentication server." }
  }
}

export async function verifyEmailRegistrationAction({
  email,
  code,
  password,
}: {
  email: string
  code: string
  password: string
}) {
  const backendUrl =
    process.env.BACKEND_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "http://localhost:8000"

  try {
    const res = await fetch(`${backendUrl}/auth/email/register/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await backendHeaders()) },
      body: JSON.stringify({ email, code, password }),
      cache: "no-store",
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { success: false, error: data.detail || "Verification failed." }
    }
    return { success: true, user: data }
  } catch (err) {
    console.error("verifyEmailRegistrationAction error:", err)
    return { success: false, error: "Failed to connect to authentication server." }
  }
}

export async function resendEmailCodeAction({ email }: { email: string }) {
  const backendUrl =
    process.env.BACKEND_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "http://localhost:8000"

  try {
    const res = await fetch(`${backendUrl}/auth/email/register/resend`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await backendHeaders()) },
      body: JSON.stringify({ email }),
      cache: "no-store",
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { success: false, error: data.detail || "Could not resend the code." }
    }
    return {
      success: true,
      resendAfter: typeof data.resend_after === "number" ? data.resend_after : 60,
    }
  } catch (err) {
    console.error("resendEmailCodeAction error:", err)
    return { success: false, error: "Failed to connect to authentication server." }
  }
}
