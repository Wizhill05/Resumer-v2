import type {
  LlmConfigResponse,
  LlmEndpoint,
  LlmEndpointCreate,
  LlmEndpointUpdate,
  LlmModelsRefreshResponse,
  LlmProbeRequest,
  LlmProbeResponse,
  LlmRoleId,
  LlmRoleUpdate,
  LlmTestRequest,
  LlmTestResponse,
} from "./types"

const BASE = "/api/backend/admin/llm"

/**
 * Normalised API error. The backend may send `detail` as a string, as
 * `{code, message, field?, roles?}`, or as FastAPI's pydantic error list.
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly field: string | null
  readonly roles: LlmRoleId[]

  constructor(status: number, code: string, message: string, field: string | null = null, roles: LlmRoleId[] = []) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.field = field
    this.roles = roles
  }
}

type PydanticIssue = { loc?: (string | number)[]; msg?: string }

function fallbackMessage(status: number): string {
  if (status === 401) return "Your session expired. Sign in again."
  if (status === 403) return "Admin access required."
  if (status === 404) return "Not found."
  if (status >= 500) return `The server failed (HTTP ${status}). Try again.`
  return `Request failed (HTTP ${status}).`
}

export function parseErrorBody(status: number, body: unknown): ApiError {
  const detail = body && typeof body === "object" && "detail" in body ? (body as { detail: unknown }).detail : body
  if (typeof detail === "string" && detail.trim()) {
    return new ApiError(status, status === 404 ? "not_found" : "error", detail)
  }
  if (Array.isArray(detail)) {
    const issues = detail as PydanticIssue[]
    const first = issues[0]
    const loc = (first?.loc ?? []).filter((p) => p !== "body")
    const field = loc.length ? String(loc[0]) : null
    const where = loc.length ? `${loc.join(".")}: ` : ""
    const extra = issues.length > 1 ? ` (+${issues.length - 1} more)` : ""
    return new ApiError(status, "validation_error", `${where}${first?.msg ?? "Invalid input"}${extra}`, field)
  }
  if (detail && typeof detail === "object") {
    const d = detail as { code?: unknown; message?: unknown; field?: unknown; roles?: unknown }
    return new ApiError(
      status,
      typeof d.code === "string" ? d.code : "error",
      typeof d.message === "string" && d.message ? d.message : fallbackMessage(status),
      typeof d.field === "string" ? d.field : null,
      Array.isArray(d.roles) ? (d.roles.filter((r) => typeof r === "string") as LlmRoleId[]) : [],
    )
  }
  return new ApiError(status, "error", fallbackMessage(status))
}

async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    })
  } catch {
    throw new ApiError(0, "network_error", "Couldn't reach the server. Check your connection.")
  }
  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text.length < 300 ? text : null
    }
  }
  if (!res.ok) throw parseErrorBody(res.status, body)
  return body as T
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return "Something went wrong."
}

export const getLlmConfig = () => request<LlmConfigResponse>("/config")

export const createEndpoint = (body: LlmEndpointCreate) =>
  request<LlmEndpoint>("/endpoints", { method: "POST", body })

export const updateEndpoint = (id: string, body: LlmEndpointUpdate) =>
  request<LlmEndpoint>(`/endpoints/${encodeURIComponent(id)}`, { method: "PATCH", body })

export const deleteEndpoint = (id: string, force: boolean) =>
  request<{ deleted: boolean; removed_from_roles: LlmRoleId[] }>(
    `/endpoints/${encodeURIComponent(id)}?force=${force ? "true" : "false"}`,
    { method: "DELETE" },
  )

export const refreshModels = (id: string) =>
  request<LlmModelsRefreshResponse>(`/endpoints/${encodeURIComponent(id)}/models/refresh`, { method: "POST" })

export const testEndpoint = (id: string, body: LlmTestRequest) =>
  request<LlmTestResponse>(`/endpoints/${encodeURIComponent(id)}/test`, { method: "POST", body })

export const probe = (body: LlmProbeRequest) => request<LlmProbeResponse>("/probe", { method: "POST", body })

export const updateRole = (role: LlmRoleId, body: LlmRoleUpdate) =>
  request<LlmConfigResponse>(`/roles/${role}`, { method: "PUT", body })
