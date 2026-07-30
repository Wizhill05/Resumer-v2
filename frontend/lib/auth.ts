import NextAuth from "next-auth"
import GitHub from "next-auth/providers/github"
import Google from "next-auth/providers/google"

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
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
