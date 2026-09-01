import NextAuth from "next-auth"
import GitHub from "next-auth/providers/github"
import Google from "next-auth/providers/google"

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
    async jwt({ token, account, profile }) {
      if (account) {
        token.provider = account.provider
        if (account.provider === "github") {
          token.githubAccessToken = account.access_token
          if (profile && "login" in profile) {
            token.githubUsername = profile.login as string
          }
        }
      }
      return token
    },
    async session({ session, token }) {
      return {
        ...session,
        githubUsername: token.githubUsername as string | undefined,
        githubAccessToken: token.githubAccessToken as string | undefined,
        token: token as Record<string, unknown>,
      }
    },
  },
})
