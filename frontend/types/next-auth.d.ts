import "next-auth"

declare module "next-auth" {
  interface User {
    uid?: string
    provider?: string
    needsWelcome?: boolean
  }
  interface Session {
    user: {
      id?: string
      email?: string | null
      name?: string | null
      image?: string | null
    } & Record<string, unknown>
    provider?: string
    needsWelcome?: boolean
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string
    provider?: string
    needsWelcome?: boolean
  }
}
