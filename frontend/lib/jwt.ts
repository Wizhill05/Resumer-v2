import { SignJWT } from "jose"

const NEXTAUTH_SECRET = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET

type SessionLike = {
  user?: { id?: string; email?: string | null; name?: string | null; image?: string | null } | null
  provider?: string | null
  needsWelcome?: boolean | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function backendTokenForSession(session: SessionLike) {
  const uid = session.user?.id ?? ""
  const email = session.user?.email ?? ""
  const provider = session.provider ?? "unknown"
  if (!NEXTAUTH_SECRET) {
    throw new Error("AUTH_SECRET or NEXTAUTH_SECRET is not set in environment.")
  }
  const JWT_SECRET = new TextEncoder().encode(NEXTAUTH_SECRET)
  const payload: Record<string, string> = { email, provider }
  if (UUID_RE.test(uid)) {
    payload.sub = uid
  }
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(JWT_SECRET)
}

export async function internalToken() {
  const secret = process.env.INTERNAL_API_SECRET
  if (!secret) {
    throw new Error("INTERNAL_API_SECRET is not set.")
  }
  const encoded = new TextEncoder().encode(secret)
  return await new SignJWT({ aud: "internal" } as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(encoded)
}
