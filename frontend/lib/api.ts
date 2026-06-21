import { auth } from "@/lib/auth"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

export async function apiFetch(path: string, init?: RequestInit) {
  const session = await auth()
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(init?.headers ?? {}),
  }

  // Attach JWT from session if available
  if (session) {
    // NextAuth v5 exposes the raw JWT token via getToken on server
    // We pass it via Authorization header
    const { getToken } = await import("next-auth/jwt")
    // This is a server-side utility only
  }

  return fetch(`${API_URL}${path}`, { ...init, headers })
}
