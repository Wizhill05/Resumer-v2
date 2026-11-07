import type { LlmError, LlmErrorCode } from "./types"

type ErrorCopy = { title: string; hint: string }

export const ERROR_COPY: Record<LlmErrorCode, ErrorCopy> = {
  invalid_url: { title: "Invalid URL", hint: "Use http(s)://host[:port][/path] without credentials, query or #fragment." },
  blocked_host: { title: "Host blocked", hint: "Link-local and cloud-metadata addresses can't be used. Localhost and private IPs are fine." },
  dns_error: { title: "Host not found", hint: "Check the hostname for typos. Internal names must resolve from the backend server." },
  connect_error: { title: "Couldn't connect", hint: "Is the server running and reachable from the backend? Check host and port." },
  timeout: { title: "Timed out", hint: "The server didn't answer in time. Try again, or raise the timeout in Advanced." },
  tls_error: { title: "TLS / certificate error", hint: "The certificate isn't trusted. Try http:// for local servers, or fix the certificate." },
  unauthorized: { title: "Token rejected", hint: "Check the bearer token. Some servers need it even for /models." },
  forbidden: { title: "Access denied", hint: "The token is valid but lacks permission for this resource or model." },
  not_found: { title: "Nothing at this URL", hint: "Check the base URL. Many servers live under /v1 (e.g. https://host/v1)." },
  rate_limited: { title: "Rate limited", hint: "The server is throttling requests. Wait a moment and retry." },
  server_error: { title: "Server error", hint: "The upstream server failed. Retry, or check its logs." },
  http_error: { title: "Unexpected HTTP response", hint: "The server answered with an error. If it redirected, use the target URL directly." },
  bad_response: { title: "Not an OpenAI-compatible response", hint: "The URL answered, but not with a models list. Try adding or removing /v1." },
  too_large: { title: "Response too large", hint: "The models list exceeded 2 MB. Point at a more specific base URL." },
  no_models: { title: "No models listed", hint: "The server returned an empty list. You can still type a model id manually." },
  missing_api_key: { title: "No token", hint: "This server needs a bearer token. Add one in the connection step." },
  undecryptable_api_key: { title: "Stored token unreadable", hint: "The server secret changed since the token was saved. Enter the token again." },
  completion_failed: { title: "Completion failed", hint: "The model didn't return a usable answer. Check the model id and permissions." },
}

export function describeError(err: LlmError | null | undefined): ErrorCopy & { message: string } {
  if (!err) return { title: "Unknown error", hint: "", message: "" }
  const copy = ERROR_COPY[err.code] ?? { title: "Error", hint: "" }
  return { ...copy, message: err.message }
}
