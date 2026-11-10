import NextAuth from "next-auth"
import GitHub from "next-auth/providers/github"
import Google from "next-auth/providers/google"
import Credentials from "next-auth/providers/credentials"
import { captureSignIn } from "@/lib/posthog-server"
import { internalToken } from "@/lib/jwt"

const BACKEND_INTERNAL_URL =
  process.env.BACKEND_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:8000"

function isAllowedHost(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

// Custom session cookie name. Renaming it from the Auth.js default (`authjs.session-token`)
// invalidated every pre-existing session at deploy: old sessions have no `uid`, never went
// through /internal/auth/resolve and could carry the wrong provider. Auth.js uses the cookie
// name as the JWT salt, so anything that decodes the session cookie must use this name too.
// Keep the secure decision explicit so the cookie name and its `secure` flag cannot disagree.
const authUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL
const useSecureCookies = authUrl
  ? authUrl.startsWith("https:")
  : Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production"

export const SESSION_COOKIE_NAME = useSecureCookies
  ? "__Secure-resumer.session-token"
  : "resumer.session-token"

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  useSecureCookies,
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE_NAME,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
  },
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
            uid: user.id,
            email: user.email,
            name: user.name,
            image: user.image ?? null,
            provider: user.provider ?? "credentials",
            needsWelcome: user.needs_welcome ?? false,
          }
        } catch (err) {
          console.error("Credentials authorization error:", err)
          return null
        }
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { error: "/auth/error" },
  events: {
    async signIn({ user, account }) {
      await captureSignIn(user.email, account?.provider)
    },
  },
  callbacks: {
    async signIn({ account, profile, user }) {
      if (!account) return true
      const provider = account.provider
      if (provider !== "google" && provider !== "github") return true

      const email = (profile?.email || user.email || "").toString().trim().toLowerCase()
      if (!email || !account.providerAccountId) return `/auth/error?auth_error=email_not_verified&provider=${encodeURIComponent(provider)}`

      let emailVerified = false
      if (provider === "google") {
        emailVerified = Boolean((profile as { email_verified?: boolean } | undefined)?.email_verified)
      }

      try {
        const token = await internalToken()
        const res = await fetch(`${BACKEND_INTERNAL_URL}/internal/auth/resolve`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            provider,
            provider_account_id: account.providerAccountId,
            email,
            email_verified: provider === "github" ? undefined : emailVerified,
            name: profile?.name ?? user.name ?? null,
            image: profile?.picture ?? profile?.avatar_url ?? user.image ?? null,
            access_token: provider === "github" ? account.access_token ?? null : undefined,
            provider_login: provider === "github" ? ((profile as { login?: string } | undefined)?.login ?? null) : undefined,
            scopes: provider === "github" ? (account.scope ?? null) : undefined,
          }),
          cache: "no-store",
        })

        if (res.status === 409) {
          let error = "provider_mismatch"
          let owner = provider
          try {
            const data = (await res.json()) as { detail?: { error?: string; provider?: string | null }; error?: string; provider?: string | null }
            const detail = data.detail ?? data
            if (detail.error) error = detail.error
            if (detail.provider) owner = detail.provider
          } catch {}
          return `/auth/error?auth_error=${encodeURIComponent(error)}&provider=${encodeURIComponent(owner)}`
        }

        if (!res.ok) {
          return "/auth/error?auth_error=unavailable"
        }

        const data = (await res.json()) as { uid: string; provider: string; needs_welcome: boolean }
        ;(user as { uid?: string; provider?: string; needsWelcome?: boolean }).uid = data.uid
        ;(user as { uid?: string; provider?: string; needsWelcome?: boolean }).provider = data.provider
        ;(user as { uid?: string; provider?: string; needsWelcome?: boolean }).needsWelcome = data.needs_welcome
        user.id = data.uid
        return true
      } catch {
        return "/auth/error?auth_error=unavailable"
      }
    },
    async redirect({ url, baseUrl }) {
      // Allow relative callback URLs
      if (url.startsWith("/")) return `${baseUrl}${url}`
      try {
        const parsed = new URL(url)
        if (
          parsed.origin === baseUrl ||
          isAllowedHost(parsed.hostname, "aryansingh.space") ||
          isAllowedHost(parsed.hostname, "resumer.buzz") ||
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
    async jwt({ token, account, user, trigger, session }) {
      if (trigger === "update" && session && typeof session === "object") {
        if ("needsWelcome" in session) {
          token.needsWelcome = Boolean((session as { needsWelcome?: boolean }).needsWelcome)
        }
      }
      if (account) {
        token.provider = token.provider ?? account.provider
      }
      if (user) {
        token.email = user.email
        token.name = user.name
        token.picture = user.image
        const u = user as { uid?: string; provider?: string; needsWelcome?: boolean }
        if (u.uid) token.uid = u.uid
        if (u.provider) token.provider = u.provider
        if (typeof u.needsWelcome === "boolean") token.needsWelcome = u.needsWelcome
        if (!token.provider) {
          token.provider = "credentials"
        }
      }
      return token
    },
    async session({ session, token }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: (token.uid as string | undefined) ?? session.user?.id,
        },
        provider: token.provider as string | undefined,
        needsWelcome: token.needsWelcome as boolean | undefined,
      }
    },
  },
})
