"use server"

import { signIn, signOut } from "@/lib/auth"

function callbackUrl(formData?: FormData) {
  const raw = formData?.get("callbackUrl")
  return typeof raw === "string" && raw.startsWith("/") ? raw : "/dashboard"
}

export async function signInGithub(formData?: FormData) {
  await signIn("github", { redirectTo: callbackUrl(formData) })
}

export async function signInGoogle(formData?: FormData) {
  await signIn("google", { redirectTo: callbackUrl(formData) })
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" })
}

export async function registerEmailUserAction({
  email,
  password,
  name,
}: {
  email: string
  password: string
  name?: string
}) {
  const backendUrl =
    process.env.BACKEND_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "http://localhost:8000"

  try {
    const res = await fetch(`${backendUrl}/auth/email/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
      cache: "no-store",
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { success: false, error: data.detail || "Registration failed." }
    }
    return { success: true, user: data }
  } catch (err) {
    console.error("registerEmailUserAction error:", err)
    return { success: false, error: "Failed to connect to authentication server." }
  }
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
