import { SignJWT } from "jose"

const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET
if (!NEXTAUTH_SECRET) {
  throw new Error("NEXTAUTH_SECRET is not set. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"")
}
const JWT_SECRET = new TextEncoder().encode(NEXTAUTH_SECRET)

export async function signBackendToken(payload: {
  email: string
  name?: string | null
  picture?: string | null
  provider?: string | null
}) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(JWT_SECRET)
}
