/**
 * Which model writes the résumé text when an AI agent (MCP connector) asks Résumer for a résumé.
 *
 * - "resumer": Résumer's own AI writes it. Counts toward the daily build limit.
 * - "own_model": the connected agent's model writes it; Résumer still picks the layout, fits it
 *   to one page and checks every line. Doesn't count toward the daily limit.
 *
 * This only affects résumés built through an agent. Builds started on the website always use
 * Résumer's AI. Turning "own_model" on always needs a person to confirm it, either here on the
 * account page or through the one-time link an agent hands out.
 */
export type InferenceMode = "resumer" | "own_model"

export interface InferenceModeState {
  mode: InferenceMode
  changed_at: string | null
}

export const OWN_MODEL_POINTS = [
  "Your agent's model writes the summary, skills and bullet points.",
  "Résumer still fills in your real roles, companies, dates and education, fits everything on one page and checks every line.",
  "These builds don't count toward your daily limit.",
  "Quality depends on the model your agent uses. Smaller models may need a few extra rounds.",
  "Résumés you build on this website keep using Résumer's AI.",
] as const

export function parseInferenceMode(value: unknown): InferenceMode {
  return value === "own_model" ? "own_model" : "resumer"
}

/** Confirmation challenges are url-safe base64; anything else never reaches the backend. */
export function isWellFormedChallenge(token: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}$/.test(token)
}
