"use server"

import { auth } from "@/lib/auth"
import { backendTokenForSession } from "@/lib/jwt"
import { isWellFormedChallenge, parseInferenceMode, type InferenceMode } from "@/lib/inference-mode"

const BACKEND_URL = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000"

export type ChallengeProblem = "used" | "expired" | "invalid" | "wrong_account" | "signed_out" | "network"

export type InspectResult = { status: "valid"; currentMode: InferenceMode } | { status: "error"; reason: ChallengeProblem }

export type ConfirmState = { status: "idle" } | { status: "confirmed" } | { status: "error"; reason: ChallengeProblem }

/**
 * Both actions talk to the backend with the signed-in browser session. The backend only accepts
 * web-session tokens for these endpoints (never an agent's OAuth token), so the agent that asked
 * for the switch can't confirm it by itself. The challenge travels in the request body only.
 */
async function callBackend(path: "inspect" | "confirm", token: string): Promise<Response | ChallengeProblem> {
  if (!isWellFormedChallenge(token)) return "invalid"
  const session = await auth()
  if (!session?.user) return "signed_out"
  try {
    return await fetch(`${BACKEND_URL}/inference-mode/challenge/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await backendTokenForSession(session)}`,
      },
      body: JSON.stringify({ token }),
      cache: "no-store",
    })
  } catch {
    return "network"
  }
}

function problemFor(res: Response): ChallengeProblem {
  if (res.status === 401) return "signed_out"
  if (res.status === 403) return "wrong_account"
  if (res.status === 409) return "used"
  if (res.status === 410) return "expired"
  // A backend hiccup isn't a broken link: let the user retry the same one.
  if (res.status >= 500) return "network"
  return "invalid"
}

export async function inspectOwnModel(token: string): Promise<InspectResult> {
  const res = await callBackend("inspect", token)
  if (typeof res === "string") return { status: "error", reason: res }
  if (!res.ok) return { status: "error", reason: problemFor(res) }
  const data = (await res.json().catch(() => ({}))) as { valid?: boolean; reason?: string | null; current_mode?: string }
  if (data.valid) return { status: "valid", currentMode: parseInferenceMode(data.current_mode) }
  const reason = data.reason
  if (reason === "used" || reason === "expired" || reason === "wrong_account") return { status: "error", reason }
  return { status: "error", reason: "invalid" }
}

export async function confirmOwnModel(_prev: ConfirmState, formData: FormData): Promise<ConfirmState> {
  const token = formData.get("challenge")
  if (typeof token !== "string") return { status: "error", reason: "invalid" }
  const res = await callBackend("confirm", token)
  if (typeof res === "string") return { status: "error", reason: res }
  if (res.ok) return { status: "confirmed" }
  return { status: "error", reason: problemFor(res) }
}
