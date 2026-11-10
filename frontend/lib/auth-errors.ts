/** Cookie holding the page an OAuth sign-in started from, for failure redirects. */
export const AUTH_RETURN_COOKIE = "resumer_auth_return"

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
  if (error === "sign_in_failed") {
    return "Sign-in didn't finish. Try again, or pick another sign-in option."
  }
  if (error === "account_deletion_scheduled") {
    return "Your account is scheduled for deletion in 7 days. Sign in before then to keep it."
  }
  if (error === "account_pending_deletion") {
    return "This account is scheduled for deletion, so you were signed out. Sign in again to restore it."
  }
  if (error === "unavailable") {
    return "Sign-in is unavailable right now. Try again."
  }
  return null
}
