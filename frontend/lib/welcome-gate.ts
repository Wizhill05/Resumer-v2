/**
 * Shared gate for the /welcome step. Reads `needsWelcome` off the session
 * with a narrow local type - the session type in `lib/auth.ts` is owned by
 * another agent, so this helper keeps the cast in one place.
 */
export function needsWelcome(session: unknown): boolean {
  if (!session) return false
  return (session as { needsWelcome?: boolean }).needsWelcome === true
}
