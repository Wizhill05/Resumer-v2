import { SignJWT } from "jose"

const JWT_SECRET = new TextEncoder().encode(
  process.env.NEXTAUTH_SECRET ?? "your-secret-here"
)

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
