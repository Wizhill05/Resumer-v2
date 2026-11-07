"use client"

import { useEffect, useState } from "react"
import type { LlmEndpoint, ModelKind } from "./types"

/** Ticking clock for relative times / countdowns. Pure during render. */
export function useNow(intervalMs = 30_000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, enabled])
  return now
}

export function relativeTime(iso: string | null | undefined, now: number): string {
  if (!iso) return "never"
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return "—"
  const s = Math.round((now - t) / 1000)
  if (s < 0) return "just now"
  if (s < 45) return "just now"
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86_400)}d ago`
}

export function secondsUntil(iso: string | null | undefined, now: number): number {
  if (!iso) return 0
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : Math.max(0, Math.ceil((t - now) / 1000))
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—"
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`
}

export function formatContext(n: number | null | undefined): string | null {
  if (!n) return null
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1024) === n / 1024 ? n / 1024 : Math.round(n / 1000)}k`
  return String(n)
}

export const KIND_LABEL: Record<ModelKind, string> = {
  chat: "Chat",
  embedding: "Embedding",
  audio: "Audio",
  image: "Image",
  moderation: "Moderation",
  other: "Other",
}

/** Mirrors the backend's candidate list (normalize_base_url + candidate_api_bases) for progress display only. */
export function predictModelsUrls(raw: string): string[] {
  let s = raw.trim()
  if (!s) return []
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`
  s = s.replace(/\/+$/, "").replace(/\/(chat\/completions|completions|models)$/i, "")
  try {
    const u = new URL(s)
    const base = `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`
    const path = u.pathname.replace(/\/+$/, "")
    if (/\/v\d+[a-z]*(\/openai)?$/i.test(path) || /\/openai$/i.test(path)) return [`${base}/models`]
    return [`${base}/v1/models`, `${base}/models`]
  } catch {
    return []
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function chatModelIds(endpoint: Pick<LlmEndpoint, "models" | "default_model">): string[] {
  const ids = endpoint.models.filter((m) => m.kind === "chat" || m.kind === "other").map((m) => m.id)
  if (endpoint.default_model && !ids.includes(endpoint.default_model)) ids.unshift(endpoint.default_model)
  return ids
}

// ---- client-side validation (mirrors backend A5 rules) -----------------------------------------

export const FORBIDDEN_HEADERS = [
  "authorization",
  "host",
  "content-length",
  "content-type",
  "cookie",
  "proxy-authorization",
  "x-api-key",
  "api-key",
]
export const MAX_HEADERS_FALLBACK = 20
const HEADER_KEY_RE = /^[A-Za-z0-9-]{1,64}$/

export function validateHeader(key: string, value: string): string | null {
  const k = key.trim()
  if (!k && !value) return null
  if (!k) return "Header name is required"
  if (!HEADER_KEY_RE.test(k)) return "Letters, digits and dashes only (max 64)"
  if (FORBIDDEN_HEADERS.includes(k.toLowerCase())) return "Put the token in the bearer token field"
  if (/[\r\n]/.test(value)) return "Value can't contain line breaks"
  if (value.length > 1024) return "Value is too long (max 1024)"
  return null
}

export function parseExtraBody(text: string): { value: Record<string, unknown>; error: string | null } {
  const t = text.trim()
  if (!t) return { value: {}, error: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(t)
  } catch (e) {
    return { value: {}, error: e instanceof Error ? `Invalid JSON: ${e.message}` : "Invalid JSON" }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { value: {}, error: "Must be a JSON object, e.g. {\"top_p\": 0.9}" }
  }
  const reserved = ["model", "messages", "stream"].filter((k) => k in (parsed as object))
  if (reserved.length) return { value: {}, error: `Reserved key${reserved.length > 1 ? "s" : ""}: ${reserved.join(", ")}` }
  if (new TextEncoder().encode(JSON.stringify(parsed)).length > 8192) return { value: {}, error: "Too large (max 8 KB)" }
  return { value: parsed as Record<string, unknown>, error: null }
}
