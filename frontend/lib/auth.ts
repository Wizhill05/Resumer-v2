import NextAuth from "next-auth"
import GitHub from "next-auth/providers/github"
import Google from "next-auth/providers/google"
import Credentials from "next-auth/providers/credentials"

const BACKEND_INTERNAL_URL =
  process.env.BACKEND_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:8000"

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID || process.env.GITHUB_CLIENT_ID || process.env.GITHUB_ID || "",
      clientSecret: process.env.AUTH_GITHUB_SECRET || process.env.GITHUB_CLIENT_SECRET || process.env.GITHUB_SECRET || "",
    }),
    Google({
      clientId: process.env.AUTH_GOOGLE_ID || process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_ID || "",
      clientSecret: process.env.AUTH_GOOGLE_SECRET || process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_SECRET || "",
    }),
    Credentials({
      id: "credentials",
      name: "Email and Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null
        const email = String(credentials.email).trim().toLowerCase()
        const password = String(credentials.password)

        try {
          const res = await fetch(`${BACKEND_INTERNAL_URL}/auth/email/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
            cache: "no-store",
          })

          if (!res.ok) {
            return null
          }

          const user = await res.json()
          return {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.image ?? null,
          }
        } catch (err) {
          console.error("Credentials authorization error:", err)
          return null
        }
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async redirect({ url, baseUrl }) {
      // Allow relative callback URLs
      if (url.startsWith("/")) return `${baseUrl}${url}`
      try {
        const parsed = new URL(url)
        if (
          parsed.origin === baseUrl ||
          parsed.hostname.endsWith("aryansingh.space") ||
          parsed.hostname.endsWith("trycloudflare.com") ||
          parsed.hostname.endsWith("vercel.app") ||
          parsed.hostname === "localhost" ||
          parsed.hostname === "127.0.0.1"
        ) {
          return url
        }
      } catch {}
      return baseUrl
    },
    async jwt({ token, account, profile, user }) {
      if (account) {
        token.provider = account.provider
        if (account.provider === "github") {
          token.githubAccessToken = account.access_token
          if (profile && "login" in profile) {
            token.githubUsername = profile.login as string
          }
        }
      }
      if (user) {
        token.email = user.email
        token.name = user.name
        token.picture = user.image
        if (!token.provider) {
          token.provider = "credentials"
        }
      }
      return token
    },
    async session({ session, token }) {
      return {
        ...session,
        provider: token.provider as string | undefined,
        githubUsername: token.githubUsername as string | undefined,
        githubAccessToken: token.githubAccessToken as string | undefined,
        token: token as Record<string, unknown>,
      }
    },
  },
})
