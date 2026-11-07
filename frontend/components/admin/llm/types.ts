// API contract types. Copied verbatim from artifacts/llm-revamp/PLAN.md §2.2 — keep in sync with backend/src/schemas/llm.py.

export type LlmRoleId = "default" | "pro" | "utility" | "audio"
export type StructuredOutputMode = "json_schema" | "json_object" | "prompt_only"
export type EndpointHealthStatus = "ok" | "error" | "unknown"
export type ApiKeyStatus = "ok" | "missing" | "undecryptable"
export type ModelKind = "chat" | "embedding" | "audio" | "image" | "moderation" | "other"

export type LlmErrorCode =
  | "invalid_url" | "blocked_host" | "dns_error" | "connect_error" | "timeout" | "tls_error"
  | "unauthorized" | "forbidden" | "not_found" | "rate_limited" | "server_error" | "http_error"
  | "bad_response" | "too_large" | "no_models" | "missing_api_key" | "undecryptable_api_key"
  | "completion_failed"

export interface LlmError {
  code: LlmErrorCode
  message: string            // friendly, safe to show; never contains the token
  status_code: number | null // upstream HTTP status if any
}

export interface LlmModelInfo {
  id: string
  owned_by: string | null
  context_length: number | null
  kind: ModelKind
  capabilities: string[]     // hints only, subset of: "json_schema" | "tools" | "vision" | "audio_input"
}

export interface LlmEndpointHealth {
  status: EndpointHealthStatus
  checked_at: string | null
  latency_ms: number | null
  error: LlmError | null
  cooldown_until: string | null // runtime circuit breaker, in-memory
}

export interface LlmEndpoint {
  id: string
  name: string
  base_url: string
  has_api_key: boolean
  api_key_hint: string | null      // e.g. "…a1b2" (last 4), null if no key
  api_key_status: ApiKeyStatus
  extra_headers: Record<string, string>
  extra_body: Record<string, unknown>
  structured_output_mode: StructuredOutputMode
  timeout_seconds: number          // 5..600, default 60
  max_retries: number              // 0..3, default 1 (attempts per target = max_retries + 1)
  default_temperature: number      // 0..2, default 0.2
  max_output_tokens: number | null // 64..65536; null => server default LLM_MAX_OUTPUT_TOKENS
  enabled: boolean
  default_model: string | null
  models: LlmModelInfo[]           // cached catalog, sorted by id
  models_fetched_at: string | null
  health: LlmEndpointHealth
  used_by_roles: LlmRoleId[]
  created_at: string
  updated_at: string
}

export interface LlmRoleTarget { endpoint_id: string; model: string }

export interface LlmEffectiveTarget extends LlmRoleTarget {
  endpoint_name: string
  endpoint_enabled: boolean
  inherited: boolean               // true when coming from `default`
}

export interface LlmRole {
  role: LlmRoleId
  label: string
  description: string
  used_for: string[]               // human-readable task names
  required: boolean                // true only for "default"
  inherits_from: LlmRoleId | null  // "default" for pro/utility, null otherwise
  targets: LlmRoleTarget[]         // as stored (may be empty)
  effective_targets: LlmEffectiveTarget[] // what runtime will actually try, in order
  temperature: number | null
  max_output_tokens: number | null
  issues: string[]                 // e.g. "Endpoint 'X' is disabled", "No targets configured"
  updated_at: string | null
}

export interface LlmConfigResponse {
  ready: boolean                   // default role has >=1 usable effective target
  endpoints: LlmEndpoint[]         // sorted by name
  roles: LlmRole[]                 // always all 4, order: default, pro, utility, audio
  limits: { max_targets_per_role: number; max_extra_headers: number }
  server_defaults: { max_output_tokens: number }
}

export interface LlmEndpointCreate {
  name?: string                    // optional; backend derives from host if blank
  base_url: string
  api_key?: string | null
  extra_headers?: Record<string, string>
  extra_body?: Record<string, unknown>
  structured_output_mode?: StructuredOutputMode
  timeout_seconds?: number
  max_retries?: number
  default_temperature?: number
  max_output_tokens?: number | null
  enabled?: boolean
  default_model?: string | null
}

export interface LlmEndpointUpdate extends Partial<Omit<LlmEndpointCreate, "api_key">> {
  api_key?: string                 // non-empty string replaces the token; omit to keep
  clear_api_key?: boolean          // true removes the token
}

export interface LlmProbeRequest {
  base_url: string
  api_key?: string                 // if omitted and endpoint_id given, stored token is used
  endpoint_id?: string
  extra_headers?: Record<string, string>
  probe_model?: string             // if set, also detects structured-output support (spends tokens)
  timeout_seconds?: number         // default 15, max 30
}

export interface LlmProbeAttempt { url: string; status_code: number | null; error_code: LlmErrorCode | null }

export interface LlmProbeResponse {
  ok: boolean
  normalized_base_url: string | null
  models_url: string | null
  latency_ms: number | null
  models: LlmModelInfo[]
  suggested_model: string | null
  suggested_name: string
  structured_output: null | {
    mode: StructuredOutputMode
    checks: { mode: StructuredOutputMode; ok: boolean; error: LlmError | null }[]
  }
  attempts: LlmProbeAttempt[]
  error: LlmError | null
}

export interface LlmModelsRefreshResponse {
  ok: boolean
  models: LlmModelInfo[]
  models_fetched_at: string | null
  error: LlmError | null
}

export interface LlmTestRequest { model?: string; prompt?: string } // model defaults to endpoint.default_model
export interface LlmTestResponse {
  ok: boolean
  model: string | null
  latency_ms: number | null
  output: string | null            // truncated to 2000 chars
  usage: { prompt_tokens: number | null; completion_tokens: number | null; total_tokens: number | null } | null
  error: LlmError | null
}

export interface LlmRoleUpdate {
  targets: LlmRoleTarget[]         // 0..3; default role may be saved empty (ready=false) — UI warns
  temperature?: number | null
  max_output_tokens?: number | null
}

export interface LlmStatusSummary {
  ready: boolean
  endpoints_total: number
  endpoints_enabled: number
  default_primary: { endpoint_name: string; model: string } | null
  pro_primary: { endpoint_name: string; model: string } | null   // effective (may be inherited)
}

// ---------------------------------------------------------------------------
// Frontend-only additions
// ---------------------------------------------------------------------------

export const ROLE_ORDER: LlmRoleId[] = ["default", "pro", "utility", "audio"]

export const STRUCTURED_OUTPUT_MODES: { value: StructuredOutputMode; label: string; help: string }[] = [
  {
    value: "json_schema",
    label: "JSON schema",
    help: "Sends response_format=json_schema with the exact schema. Most reliable when the server supports it (OpenAI, vLLM, most gateways).",
  },
  {
    value: "json_object",
    label: "JSON object",
    help: "Sends response_format=json_object. The schema goes in the prompt; the server only guarantees valid JSON.",
  },
  {
    value: "prompt_only",
    label: "Prompt only",
    help: "No response_format. The schema is described in the prompt and the output is parsed locally. Works everywhere, least strict.",
  },
]
