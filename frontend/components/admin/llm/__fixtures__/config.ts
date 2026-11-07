// Development fixture for rendering the LLM settings UI without a backend.
// NOT imported by production code. Shapes follow artifacts/llm-revamp/PLAN.md §2.2.
import type { LlmConfigResponse, LlmEndpoint, LlmModelInfo } from "../types"

const iso = (minutesAgo: number) => new Date(Date.UTC(2026, 10, 7, 12, 0) - minutesAgo * 60_000).toISOString()

const mockModels: LlmModelInfo[] = [
  { id: "mock-chat-large", owned_by: "mock", context_length: 131072, kind: "chat", capabilities: ["json_schema", "tools"] },
  { id: "mock-chat-mini", owned_by: "mock", context_length: null, kind: "chat", capabilities: [] },
  { id: "mock-embed-small", owned_by: null, context_length: null, kind: "embedding", capabilities: [] },
  { id: "mock-whisper", owned_by: null, context_length: null, kind: "audio", capabilities: [] },
]

const base = {
  extra_headers: {},
  extra_body: {},
  timeout_seconds: 60,
  max_retries: 1,
  default_temperature: 0.2,
  max_output_tokens: null,
  created_at: iso(600),
  updated_at: iso(30),
} satisfies Partial<LlmEndpoint>

export const endpointMock: LlmEndpoint = {
  ...base,
  id: "6f1c0000-0000-4000-8000-000000000001",
  name: "mock-local",
  base_url: "http://127.0.0.1:9911/v1",
  has_api_key: true,
  api_key_hint: "…oken",
  api_key_status: "ok",
  structured_output_mode: "json_schema",
  enabled: true,
  default_model: "mock-chat-large",
  models: mockModels,
  models_fetched_at: iso(2),
  health: { status: "ok", checked_at: iso(2), latency_ms: 212.4, error: null, cooldown_until: null },
  used_by_roles: ["default", "pro"],
}

export const endpointBroken: LlmEndpoint = {
  ...base,
  id: "9a2d0000-0000-4000-8000-000000000002",
  name: "backup-gateway",
  base_url: "https://gateway.example.com/v1",
  has_api_key: true,
  api_key_hint: "…a1b2",
  api_key_status: "ok",
  structured_output_mode: "json_object",
  enabled: true,
  default_model: "llama-3.3-70b",
  models: [{ id: "llama-3.3-70b", owned_by: "meta", context_length: 128000, kind: "chat", capabilities: [] }],
  models_fetched_at: iso(300),
  health: {
    status: "error",
    checked_at: iso(5),
    latency_ms: 95,
    error: { code: "unauthorized", message: "The server rejected the bearer token (HTTP 401). Check the token.", status_code: 401 },
    cooldown_until: null,
  },
  used_by_roles: ["default"],
}

export const configFixture: LlmConfigResponse = {
  ready: true,
  endpoints: [endpointBroken, endpointMock].sort((a, b) => a.name.localeCompare(b.name)),
  roles: [
    {
      role: "default",
      label: "Resume generation",
      description: "Every pipeline step for regular users, the resume retailor and the prompt playground.",
      used_for: ["Job analysis", "Selection", "Summary & skills", "Experience", "Projects", "Retailor", "Prompt playground"],
      required: true,
      inherits_from: null,
      targets: [
        { endpoint_id: endpointMock.id, model: "mock-chat-large" },
        { endpoint_id: endpointBroken.id, model: "llama-3.3-70b" },
      ],
      effective_targets: [
        { endpoint_id: endpointMock.id, model: "mock-chat-large", endpoint_name: endpointMock.name, endpoint_enabled: true, inherited: false },
        { endpoint_id: endpointBroken.id, model: "llama-3.3-70b", endpoint_name: endpointBroken.name, endpoint_enabled: true, inherited: false },
      ],
      temperature: null,
      max_output_tokens: null,
      issues: [],
      updated_at: iso(30),
    },
    {
      role: "pro",
      label: "Resume generation (Pro)",
      description: "Every pipeline step for Pro users.",
      used_for: ["All pipeline steps (Pro)"],
      required: false,
      inherits_from: "default",
      targets: [{ endpoint_id: endpointMock.id, model: "mock-chat-mini" }],
      effective_targets: [
        { endpoint_id: endpointMock.id, model: "mock-chat-mini", endpoint_name: endpointMock.name, endpoint_enabled: true, inherited: false },
      ],
      temperature: 0.3,
      max_output_tokens: 8192,
      issues: [],
      updated_at: iso(30),
    },
    {
      role: "utility",
      label: "Imports & support triage",
      description: "Resume import, GitHub import and support summaries.",
      used_for: ["Resume import", "GitHub import", "Support summarization"],
      required: false,
      inherits_from: "default",
      targets: [],
      effective_targets: [
        { endpoint_id: endpointMock.id, model: "mock-chat-large", endpoint_name: endpointMock.name, endpoint_enabled: true, inherited: true },
        { endpoint_id: endpointBroken.id, model: "llama-3.3-70b", endpoint_name: endpointBroken.name, endpoint_enabled: true, inherited: true },
      ],
      temperature: null,
      max_output_tokens: null,
      issues: [],
      updated_at: null,
    },
    {
      role: "audio",
      label: "Voice transcription",
      description: "Transcribes voice notes attached to support requests.",
      used_for: ["Support transcription"],
      required: false,
      inherits_from: null,
      targets: [],
      effective_targets: [],
      temperature: null,
      max_output_tokens: null,
      issues: ["No targets configured"],
      updated_at: null,
    },
  ],
  limits: { max_targets_per_role: 3, max_extra_headers: 20 },
  server_defaults: { max_output_tokens: 16384 },
}

export const emptyConfigFixture: LlmConfigResponse = {
  ...configFixture,
  ready: false,
  endpoints: [],
  roles: configFixture.roles.map((r) => ({
    ...r,
    targets: [],
    effective_targets: [],
    issues: r.role === "default" ? ["No targets configured"] : [],
  })),
}
