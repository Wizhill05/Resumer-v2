import { SignJWT } from "jose"

const NEXTAUTH_SECRET = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET

export async function signBackendToken(payload: {
  email: string
  name?: string | null
  picture?: string | null
  provider?: string | null
  github_username?: string | null
  github_access_token?: string | null
}) {
  if (!NEXTAUTH_SECRET) {
    throw new Error("AUTH_SECRET or NEXTAUTH_SECRET is not set in environment.")
  }
  const JWT_SECRET = new TextEncoder().encode(NEXTAUTH_SECRET)

  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(JWT_SECRET)
}
