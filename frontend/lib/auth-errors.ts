export function authErrorMessage(error: string | null, provider: string | null): string | null {
  if (!error) return null
  if (error === "provider_mismatch") {
    if (provider === "credentials") {
      return "This email is registered with an email and password. Sign in with your email and password."
    }
    const label = provider === "github" ? "GitHub" : "Google"
    return `This email is registered with ${label}. Sign in with ${label}.`
  }
  if (error === "linked_not_login") {
    const label = provider === "github" ? "GitHub" : "Google"
    return `This GitHub account is connected to a Résumer account that signs in with ${label}. Sign in with ${label}.`
  }
  if (error === "email_not_verified") {
    const label = provider === "github" ? "GitHub" : "Google"
    return `Your ${label} email isn't verified.`
  }
  if (error === "unavailable") {
    return "Sign-in is unavailable right now. Try again."
  }
  return null
}
