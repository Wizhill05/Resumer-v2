import { randomUUID } from "node:crypto"

export async function captureSignIn(email: string | null | undefined, provider: string | undefined) {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  const environment = process.env.VERCEL_ENV || process.env.NODE_ENV
  if (!key || environment !== "production" || !email) return

  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com"}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        event: "user_signed_in",
        uuid: randomUUID(),
        properties: {
          distinct_id: email.trim().toLowerCase(),
          provider,
          is_signed_in: true,
          environment,
          source: "auth_server",
          $process_person_profile: false,
        },
      }),
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) console.warn("PostHog sign-in event rejected", { status: response.status })
  } catch {
    console.warn("PostHog sign-in event delivery failed")
  }
}
