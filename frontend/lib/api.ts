import { auth } from "@/lib/auth"

const API_URL = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000"

export async function apiFetch(path: string, init?: RequestInit) {
  const session = await auth()
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(init?.headers ?? {}),
  }

  // Attach JWT from session if available
  if (session) {
    // NextAuth v5 raw JWT token handling on server
  }

  return fetch(`${API_URL}${path}`, { ...init, headers })
}
