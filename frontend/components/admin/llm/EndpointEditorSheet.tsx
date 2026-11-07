"use client"

import { useId, useMemo, useState } from "react"
import { AlertTriangle, Braces, Check, CheckCircle2, CircleDashed, Radar, Sparkles, Wand2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type {
  LlmConfigResponse,
  LlmEndpoint,
  LlmEndpointCreate,
  LlmEndpointUpdate,
  LlmProbeRequest,
  LlmProbeResponse,
  LlmRoleId,
  StructuredOutputMode,
} from "./types"
import { ROLE_ORDER, STRUCTURED_OUTPUT_MODES } from "./types"
import { useSecretSafeActions } from "./hooks"
import { ApiError, errorMessage } from "./api"
import { describeError } from "./errors"
import { MAX_HEADERS_FALLBACK, formatLatency, hostOf, parseExtraBody, predictModelsUrls } from "./format"
import { Callout, Confirm, Disclosure, FieldError, FieldLabel, Sheet, Spinner, StepHeading, Switch, Tag } from "./primitives"
import { TokenField, type TokenState } from "./TokenField"
import { HeadersEditor, headerRowsError, headersToRows, rowsToHeaders, type HeaderRow } from "./HeadersEditor"
import { ModelPicker } from "./ModelPicker"

export type EditorTarget = { endpoint: LlmEndpoint | null }

type ProbeState =
  | { status: "idle" }
  | { status: "running"; urls: string[] }
  | { status: "done"; result: LlmProbeResponse; key: string; typedUrl: string }
  | { status: "failed"; message: string }

type JsonDetect =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: NonNullable<LlmProbeResponse["structured_output"]> }
  | { status: "failed"; message: string }

type Form = {
  baseUrl: string
  name: string
  defaultModel: string | null
  structuredMode: StructuredOutputMode
  temperature: number
  maxTokens: string
  timeout: string
  retries: number
  headers: HeaderRow[]
  extraBody: string
  enabled: boolean
}

function initialForm(ep: LlmEndpoint | null): Form {
  return {
    baseUrl: ep?.base_url ?? "",
    name: ep?.name ?? "",
    defaultModel: ep?.default_model ?? null,
    structuredMode: ep?.structured_output_mode ?? "json_schema",
    temperature: ep?.default_temperature ?? 0.2,
    maxTokens: ep?.max_output_tokens != null ? String(ep.max_output_tokens) : "",
    timeout: String(ep?.timeout_seconds ?? 60),
    retries: ep?.max_retries ?? 1,
    headers: headersToRows(ep?.extra_headers ?? {}),
    extraBody: ep && Object.keys(ep.extra_body).length ? JSON.stringify(ep.extra_body, null, 2) : "",
    enabled: ep?.enabled ?? true,
  }
}

const snapshot = (f: Form) =>
  JSON.stringify({ ...f, headers: f.headers.map((h) => [h.key, h.value]), extraBody: f.extraBody.trim() })

/** Non-reversible fingerprint so the "connection changed" check never keeps the raw token around. */
function fingerprint(value: string): string {
  let h = 5381
  for (let i = 0; i < value.length; i++) h = ((h << 5) + h + value.charCodeAt(i)) | 0
  return `${value.length}:${(h >>> 0).toString(36)}`
}

const sortedJson = (o: Record<string, unknown>) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]))

function intIn(raw: string, min: number, max: number): number | null {
  const n = Number(raw.trim())
  return raw.trim() && Number.isInteger(n) && n >= min && n <= max ? n : null
}

export function EndpointEditorSheet({
  target,
  config,
  onClose,
  onSaved,
}: {
  target: EditorTarget
  config: LlmConfigResponse
  onClose: () => void
  onSaved: (message: string, tone?: "ok" | "warn") => void
}) {
  const uid = useId()
  const ep = target.endpoint
  const isEdit = !!ep
  const actions = useSecretSafeActions()

  const [form, setForm] = useState<Form>(() => initialForm(ep))
  const [initialSnap] = useState(() => snapshot(initialForm(ep)))
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  const [token, setToken] = useState<TokenState>(() =>
    ep?.has_api_key ? { action: ep.api_key_status === "undecryptable" ? "replace" : "keep", value: "" } : { action: "new", value: "" },
  )
  const [probe, setProbe] = useState<ProbeState>({ status: "idle" })
  const [jsonDetect, setJsonDetect] = useState<JsonDetect>({ status: "idle" })
  const [useFor, setUseFor] = useState<Set<LlmRoleId>>(() => new Set(!isEdit && !config.ready ? ["default"] : []))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<ApiError | Error | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  // ---- derived -------------------------------------------------------------------------------
  const typedToken = token.action === "new" || token.action === "replace" ? token.value.trim() : ""
  const headerObj = rowsToHeaders(form.headers)
  const connKey = JSON.stringify([form.baseUrl.trim(), fingerprint(typedToken), token.action, sortedJson(headerObj)])
  const probeOk = probe.status === "done" && probe.result.ok
  const probeStale = probe.status === "done" && probe.key !== connKey
  const models = probeOk ? probe.result.models : (ep?.models ?? [])
  const modelsSource = probeOk ? "detected" : ep?.models.length ? "cached" : null
  const selectedModel = form.defaultModel ? models.find((m) => m.id === form.defaultModel) : undefined

  const extra = parseExtraBody(form.extraBody)
  const headersErr = headerRowsError(form.headers)
  const timeoutVal = intIn(form.timeout, 5, 600)
  const maxTokVal = form.maxTokens.trim() ? intIn(form.maxTokens, 64, 65536) : null
  const fieldErrors: Partial<Record<string, string>> = {
    base_url: !form.baseUrl.trim() ? "Base URL is required" : undefined,
    name: form.name.trim().length > 64 ? "Max 64 characters" : isEdit && !form.name.trim() ? "Name is required" : undefined,
    timeout_seconds: timeoutVal === null ? "Whole seconds between 5 and 600" : undefined,
    max_output_tokens: form.maxTokens.trim() && maxTokVal === null ? "Whole number between 64 and 65536, or blank" : undefined,
    extra_headers: headersErr ?? undefined,
    extra_body: extra.error ?? undefined,
    use_for: useFor.size > 0 && !form.defaultModel ? "Pick a model to route tasks to this endpoint" : undefined,
  }
  if (saveError instanceof ApiError && saveError.field && !fieldErrors[saveError.field]) {
    fieldErrors[saveError.field] = saveError.message
  }
  const blocking = Object.entries(fieldErrors).some(([k, v]) => v && !(saveError instanceof ApiError && saveError.field === k))
  const tokenDirty = token.action === "remove" || !!typedToken
  const dirty = snapshot(form) !== initialSnap || tokenDirty || useFor.size !== (!isEdit && !config.ready ? 1 : 0)
  const advancedSummary = [
    STRUCTURED_OUTPUT_MODES.find((m) => m.value === form.structuredMode)?.label,
    `${form.timeout || "?"}s`,
    `${form.retries} ${form.retries === 1 ? "retry" : "retries"}`,
    form.headers.length ? `${form.headers.length} hdr` : null,
    !form.enabled ? "disabled" : null,
  ]
    .filter(Boolean)
    .join(" · ")

  // ---- actions -------------------------------------------------------------------------------
  const probeBody = (probeModel?: string): LlmProbeRequest => {
    const body: LlmProbeRequest = { base_url: form.baseUrl.trim(), extra_headers: headerObj }
    if (typedToken) body.api_key = typedToken
    else if (ep?.has_api_key && token.action !== "remove") body.endpoint_id = ep.id
    if (probeModel) body.probe_model = probeModel
    return body
  }

  const runProbe = async () => {
    if (!form.baseUrl.trim() || probe.status === "running") return
    const typedUrl = form.baseUrl.trim()
    setProbe({ status: "running", urls: predictModelsUrls(typedUrl) })
    try {
      const result = await actions.probe(probeBody())
      let nextUrl = typedUrl
      if (result.ok && result.normalized_base_url) {
        nextUrl = result.normalized_base_url
        setForm((f) => ({
          ...f,
          // Don't clobber a URL the admin edited while the probe was in flight.
          baseUrl: f.baseUrl.trim() === typedUrl ? nextUrl : f.baseUrl,
          name: f.name.trim() ? f.name : result.suggested_name,
          defaultModel: f.defaultModel ?? result.suggested_model,
        }))
      }
      setProbe({
        status: "done",
        result,
        typedUrl,
        key: JSON.stringify([nextUrl, fingerprint(typedToken), token.action, sortedJson(headerObj)]),
      })
    } catch (err) {
      setProbe({ status: "failed", message: errorMessage(err) })
    }
  }

  const runJsonDetect = async () => {
    if (!form.defaultModel || jsonDetect.status === "running") return
    setJsonDetect({ status: "running" })
    try {
      const res = await actions.probe(probeBody(form.defaultModel))
      if (res.structured_output) {
        setJsonDetect({ status: "done", result: res.structured_output })
        set("structuredMode", res.structured_output.mode)
      } else {
        setJsonDetect({ status: "failed", message: res.error ? `${describeError(res.error).title}: ${res.error.message}` : "The server didn't return a structured-output result." })
      }
    } catch (err) {
      setJsonDetect({ status: "failed", message: errorMessage(err) })
    }
  }

  const commonBody = () => ({
    base_url: form.baseUrl.trim(),
    extra_headers: headerObj,
    extra_body: extra.value,
    structured_output_mode: form.structuredMode,
    timeout_seconds: timeoutVal ?? 60,
    max_retries: form.retries,
    default_temperature: form.temperature,
    max_output_tokens: maxTokVal,
    enabled: form.enabled,
    default_model: form.defaultModel?.trim() || null,
  })

  const save = async () => {
    if (blocking || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      if (!ep) {
        const body: LlmEndpointCreate = { ...commonBody() }
        if (form.name.trim()) body.name = form.name.trim()
        if (typedToken) body.api_key = typedToken
        const created = await actions.createEndpoint(body)
        setToken({ action: "new", value: "" })
        const failures: string[] = []
        const routed: string[] = []
        for (const roleId of ROLE_ORDER) {
          if (!useFor.has(roleId) || !form.defaultModel) continue
          const role = config.roles.find((r) => r.role === roleId)
          if (!role) continue
          const model = form.defaultModel.trim()
          const targets = [
            { endpoint_id: created.id, model },
            ...role.targets.filter((t) => !(t.endpoint_id === created.id && t.model === model)),
          ].slice(0, config.limits.max_targets_per_role)
          try {
            await actions.updateRole(roleId, { targets, temperature: role.temperature, max_output_tokens: role.max_output_tokens })
            routed.push(role.label)
          } catch (err) {
            failures.push(`${role.label} (${errorMessage(err)})`)
          }
        }
        await actions.invalidate()
        if (failures.length) {
          onSaved(`Added “${created.name}”, but routing failed for ${failures.join("; ")}. Edit the task under Routing.`, "warn")
        } else {
          onSaved(`Added “${created.name}”${routed.length ? ` as primary for ${routed.join(", ")}` : ""}.`)
        }
      } else {
        const next = commonBody()
        const patch: LlmEndpointUpdate = {}
        if (form.name.trim() !== ep.name) patch.name = form.name.trim()
        if (next.base_url !== ep.base_url) patch.base_url = next.base_url
        if (sortedJson(next.extra_headers) !== sortedJson(ep.extra_headers)) patch.extra_headers = next.extra_headers
        if (sortedJson(next.extra_body) !== sortedJson(ep.extra_body)) patch.extra_body = next.extra_body
        if (next.structured_output_mode !== ep.structured_output_mode) patch.structured_output_mode = next.structured_output_mode
        if (next.timeout_seconds !== ep.timeout_seconds) patch.timeout_seconds = next.timeout_seconds
        if (next.max_retries !== ep.max_retries) patch.max_retries = next.max_retries
        if (next.default_temperature !== ep.default_temperature) patch.default_temperature = next.default_temperature
        if (next.max_output_tokens !== ep.max_output_tokens) patch.max_output_tokens = next.max_output_tokens
        if (next.enabled !== ep.enabled) patch.enabled = next.enabled
        if (next.default_model !== ep.default_model) patch.default_model = next.default_model
        if (token.action === "remove") patch.clear_api_key = true
        else if (typedToken) patch.api_key = typedToken
        if (Object.keys(patch).length === 0) {
          onClose()
          return
        }
        const updated = await actions.updateEndpoint(ep.id, patch)
        setToken({ action: updated.has_api_key ? "keep" : "new", value: "" })
        await actions.invalidate()
        onSaved(`Saved “${updated.name}”.`)
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err : new Error(errorMessage(err)))
      setSaving(false)
    }
  }

  const requestClose = () => {
    if (saving) return
    if (dirty) setConfirmDiscard(true)
    else onClose()
  }

  // ---- render --------------------------------------------------------------------------------
  const roleById = useMemo(() => new Map(config.roles.map((r) => [r.role, r])), [config.roles])

  return (
      <Sheet
        open
        onRequestClose={requestClose}
        eyebrow={isEdit ? "Edit endpoint" : "New endpoint"}
        title={isEdit ? ep.name : "Connect an OpenAI-compatible API"}
        description={
          isEdit
            ? <span className="font-mono">{ep.base_url}</span>
            : "Paste a base URL and token. We find the models endpoint and list what you can use."
        }
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1 text-xs" role="status" aria-live="polite">
              {saveError ? (
                <span className="font-semibold text-red-600 dark:text-red-400">{saveError.message}</span>
              ) : !isEdit && !probeOk && form.baseUrl.trim() ? (
                <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                  <AlertTriangle size={13} aria-hidden /> Models couldn&apos;t be fetched yet; you can still type a model id.
                </span>
              ) : dirty ? (
                <span className="text-zinc-500">Unsaved changes</span>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 sm:flex-none" onClick={requestClose} disabled={saving}>
                Cancel
              </Button>
              <Button className="flex-1 sm:flex-none" onClick={save} disabled={blocking || saving || (isEdit && !dirty)}>
                {saving && <Spinner />}
                {isEdit ? "Save changes" : useFor.size ? "Add & route" : "Add endpoint"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="divide-y-2 divide-dashed divide-zinc-200 dark:divide-zinc-800">
          {/* 01 CONNECTION ------------------------------------------------------------------ */}
          <section className="px-4 py-6 sm:px-6" aria-label="Connection">
            <StepHeading
              index={1}
              title="Connection"
              done={probeOk && !probeStale}
              description="Base URL of the API (with or without /v1). Loopback and private hosts are fine for self-hosted servers."
              aside={
                probeOk && !probeStale ? (
                  <Tag tone="ok">
                    <Check size={10} aria-hidden /> {probe.result.models.length} models · {formatLatency(probe.result.latency_ms)}
                  </Tag>
                ) : probeStale ? (
                  <Tag tone="warn">changed, re-detect</Tag>
                ) : null
              }
            />
            <div className="space-y-4">
              <div>
                <FieldLabel htmlFor={`${uid}-url`}>Base URL</FieldLabel>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id={`${uid}-url`}
                    value={form.baseUrl}
                    onChange={(e) => set("baseUrl", e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        void runProbe()
                      }
                    }}
                    placeholder="https://api.example.com/v1"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus={!isEdit}
                    aria-invalid={saveError instanceof ApiError && saveError.field === "base_url"}
                    className="h-10 font-mono"
                  />
                  <Button
                    size="lg"
                    className="h-10! md:h-10! shrink-0"
                    onClick={runProbe}
                    disabled={!form.baseUrl.trim() || probe.status === "running"}
                  >
                    {probe.status === "running" ? <Spinner /> : <Radar size={15} />}
                    {probe.status === "done" ? "Re-detect" : "Auto-detect"}
                  </Button>
                </div>
                {saveError instanceof ApiError && saveError.field === "base_url" && <FieldError>{saveError.message}</FieldError>}
                {probe.status === "done" && probe.result.ok && probe.result.normalized_base_url && probe.typedUrl !== probe.result.normalized_base_url && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">
                    <Sparkles size={12} aria-hidden />
                    Using <span className="font-mono font-bold">{probe.result.normalized_base_url}</span> (detected)
                  </p>
                )}
              </div>

              <TokenField
                state={token}
                onChange={setToken}
                hasStored={!!ep?.has_api_key}
                hint={ep?.api_key_hint ?? null}
                status={ep?.api_key_status ?? null}
              />

              <div>
                <FieldLabel htmlFor={`${uid}-name`} optional={!isEdit} hint={!isEdit ? "defaults to the host name" : undefined}>
                  Display name
                </FieldLabel>
                <Input
                  id={`${uid}-name`}
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder={probe.status === "done" ? probe.result.suggested_name : form.baseUrl ? hostOf(form.baseUrl.includes("://") ? form.baseUrl : `https://${form.baseUrl}`) : "e.g. OpenAI production"}
                  maxLength={80}
                  aria-invalid={!!fieldErrors.name}
                />
                <FieldError>{fieldErrors.name}</FieldError>
              </div>

              {/* Probe progress / outcome */}
              {probe.status === "running" && (
                <div className="border-2 border-zinc-900 bg-white p-3 dark:border-zinc-600 dark:bg-zinc-950/40" role="status" aria-live="polite">
                  <p className="mb-2 text-[11px] font-black uppercase tracking-wider">Looking for a models endpoint…</p>
                  <ul className="space-y-1.5">
                    {(probe.urls.length ? probe.urls : [form.baseUrl]).map((u, i) => (
                      <li key={u} className="flex items-center gap-2 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                        {i === 0 ? <Spinner size={12} className="text-[#ff4e26]" /> : <CircleDashed size={12} aria-hidden className="shrink-0 text-zinc-300" />}
                        <span className="truncate">GET {u}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {probe.status === "failed" && <Callout tone="danger" title="Auto-detect couldn't run">{probe.message}</Callout>}
              {probe.status === "done" && !probe.result.ok && (
                <div className="border-l-4 border-red-600 bg-red-50 dark:bg-red-950/40" role="alert">
                  <div className="px-3 py-2.5 text-xs text-red-900 dark:text-red-200">
                    <p className="flex items-center gap-1.5 font-black">
                      <XCircle size={14} aria-hidden /> {describeError(probe.result.error).title}
                      {probe.result.error?.status_code ? <span className="font-mono font-medium">HTTP {probe.result.error.status_code}</span> : null}
                    </p>
                    <p className="mt-1">{probe.result.error?.message}</p>
                    {describeError(probe.result.error).hint && (
                      <p className="mt-1 text-red-700/80 dark:text-red-300/80">{describeError(probe.result.error).hint}</p>
                    )}
                  </div>
                  {probe.result.attempts.length > 0 && (
                    <div className="border-t border-red-200 px-3 py-1.5 dark:border-red-900/60">
                      <Disclosure title={`Attempts (${probe.result.attempts.length})`}>
                        <ul className="space-y-1 pb-1.5 pl-7 pt-1">
                          {probe.result.attempts.map((a) => (
                            <li key={a.url} className="flex items-center gap-2 font-mono text-[11px]">
                              <span
                                className={cn(
                                  "w-9 shrink-0 text-center font-bold",
                                  a.status_code && a.status_code < 300 ? "text-emerald-700" : "text-red-700 dark:text-red-300",
                                )}
                              >
                                {a.status_code ?? "—"}
                              </span>
                              <span className="min-w-0 flex-1 truncate" title={a.url}>
                                {a.url}
                              </span>
                              {a.error_code && <span className="shrink-0 text-red-600/80 dark:text-red-300/80">{a.error_code}</span>}
                            </li>
                          ))}
                        </ul>
                      </Disclosure>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* 02 MODEL ----------------------------------------------------------------------- */}
          <section className="px-4 py-6 sm:px-6" aria-label="Default model">
            <StepHeading
              index={2}
              title="Default model"
              done={!!form.defaultModel}
              description={
                modelsSource === "detected"
                  ? "Live list from the server. Search, filter by type, or type any id."
                  : modelsSource === "cached"
                    ? "Cached list from the last refresh. Re-detect above to update it."
                    : "Run Auto-detect to load the catalog, or type an exact model id."
              }
              aside={
                form.defaultModel ? (
                  <Tag tone="accent" className="max-w-[16rem]" title={form.defaultModel}>
                    <span className="truncate">{form.defaultModel}</span>
                  </Tag>
                ) : null
              }
            />
            <ModelPicker models={models} value={form.defaultModel} onChange={(id) => set("defaultModel", id)} label="Default model" />

            <div className="mt-3 flex flex-col gap-2 border border-zinc-200 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/60 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-xs font-black">
                  <Braces size={13} aria-hidden /> Structured output:{" "}
                  <span className="font-mono font-bold text-[#ff4e26]">
                    {STRUCTURED_OUTPUT_MODES.find((m) => m.value === form.structuredMode)?.label}
                  </span>
                  {selectedModel?.capabilities.includes("json_schema") && jsonDetect.status === "idle" && (
                    <Tag tone="info">server advertises JSON</Tag>
                  )}
                </p>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  Sends two tiny test completions (spends a few tokens) to find the strictest mode the model supports.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={runJsonDetect}
                disabled={!form.defaultModel || jsonDetect.status === "running" || !form.baseUrl.trim()}
              >
                {jsonDetect.status === "running" ? <Spinner size={13} /> : <Wand2 size={13} />} Detect JSON support
              </Button>
            </div>
            {jsonDetect.status === "failed" && <Callout tone="danger" className="mt-2">{jsonDetect.message}</Callout>}
            {jsonDetect.status === "done" && (
              <ul className="mt-2 grid gap-1.5 sm:grid-cols-2" aria-label="Structured output checks">
                {jsonDetect.result.checks.map((c) => (
                  <li
                    key={c.mode}
                    className={cn(
                      "flex items-start gap-2 border px-2.5 py-1.5 text-[11px]",
                      c.ok
                        ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                        : "border-zinc-300 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400",
                    )}
                  >
                    {c.ok ? <CheckCircle2 size={13} aria-hidden className="mt-px shrink-0" /> : <XCircle size={13} aria-hidden className="mt-px shrink-0" />}
                    <span className="min-w-0">
                      <span className="font-mono font-bold">{c.mode}</span> {c.ok ? "works" : "not supported"}
                      {!c.ok && c.error && <span className="block truncate opacity-80" title={c.error.message}>{c.error.message}</span>}
                    </span>
                  </li>
                ))}
                <li className="text-[11px] text-zinc-500 sm:col-span-2">
                  Mode set to <span className="font-mono font-bold">{jsonDetect.result.mode}</span>. Change it under Advanced.
                </li>
              </ul>
            )}
          </section>

          {/* 03 USE FOR (create only) ---------------------------------------------------------- */}
          {!isEdit && (
            <section className="px-4 py-6 sm:px-6" aria-label="Use for">
              <StepHeading
                index={3}
                title="Use for"
                done={useFor.size > 0}
                description="Checked tasks get this endpoint + model as their primary. Existing targets become fallbacks."
              />
              <div className="grid gap-2 sm:grid-cols-2">
                {ROLE_ORDER.map((id) => {
                  const role = roleById.get(id)
                  if (!role) return null
                  const primary = role.effective_targets[0]
                  const checked = useFor.has(id)
                  return (
                    <label
                      key={id}
                      className={cn(
                        "flex cursor-pointer gap-3 border-2 p-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[#ff4e26]",
                        checked
                          ? "border-zinc-900 bg-white shadow-[2px_2px_0_#18181b] dark:border-zinc-400 dark:bg-zinc-900 dark:shadow-[2px_2px_0_#000]"
                          : "border-zinc-200 bg-white/60 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/40",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setUseFor((s) => {
                            const next = new Set(s)
                            if (e.target.checked) next.add(id)
                            else next.delete(id)
                            return next
                          })
                        }
                        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#ff4e26]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-black uppercase tracking-wide">
                          {role.label}
                          {role.required && <span className="ml-1.5 font-mono text-[9px] text-[#ff4e26]">required</span>}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[11px] text-zinc-500">
                          {primary
                            ? `${primary.inherited ? "inherits " : "now: "}${primary.endpoint_name} · ${primary.model}`
                            : id === "audio"
                              ? "off"
                              : "not configured"}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
              <FieldError>{fieldErrors.use_for}</FieldError>
            </section>
          )}

          {/* ADVANCED ------------------------------------------------------------------------- */}
          <section className="px-4 py-5 sm:px-6">
            <Disclosure title="Advanced" summary={advancedSummary}>
              <div className="space-y-6 pb-2 pt-4">
                <fieldset>
                  <legend className="mb-2 text-[11px] font-black uppercase tracking-wider">Structured output mode</legend>
                  <div className="grid gap-2">
                    {STRUCTURED_OUTPUT_MODES.map((m) => (
                      <label
                        key={m.value}
                        className={cn(
                          "flex cursor-pointer gap-3 border px-3 py-2.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[#ff4e26]",
                          form.structuredMode === m.value
                            ? "border-zinc-900 bg-white dark:border-zinc-400 dark:bg-zinc-900"
                            : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800",
                        )}
                      >
                        <input
                          type="radio"
                          name={`${uid}-mode`}
                          value={m.value}
                          checked={form.structuredMode === m.value}
                          onChange={() => set("structuredMode", m.value)}
                          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#ff4e26]"
                        />
                        <span>
                          <span className="block text-xs font-black">
                            {m.label} <span className="font-mono text-[10px] font-medium text-zinc-400">{m.value}</span>
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">{m.help}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <FieldLabel htmlFor={`${uid}-temp`} hint={<span className="font-bold text-zinc-700 dark:text-zinc-200">{form.temperature.toFixed(2)}</span>}>
                      Default temperature
                    </FieldLabel>
                    <input
                      id={`${uid}-temp`}
                      type="range"
                      min={0}
                      max={2}
                      step={0.05}
                      value={form.temperature}
                      onChange={(e) => set("temperature", Number(e.target.value))}
                      className="h-9 w-full cursor-pointer accent-[#ff4e26]"
                    />
                    <div className="flex justify-between font-mono text-[9px] uppercase text-zinc-400">
                      <span>0 precise</span>
                      <span>2 creative</span>
                    </div>
                  </div>
                  <div>
                    <FieldLabel htmlFor={`${uid}-maxtok`} hint="64 – 65536" optional>
                      Max output tokens
                    </FieldLabel>
                    <Input
                      id={`${uid}-maxtok`}
                      inputMode="numeric"
                      value={form.maxTokens}
                      onChange={(e) => set("maxTokens", e.target.value)}
                      placeholder={`server default (${config.server_defaults.max_output_tokens.toLocaleString()})`}
                      aria-invalid={!!fieldErrors.max_output_tokens}
                      className="font-mono"
                    />
                    <FieldError>{fieldErrors.max_output_tokens}</FieldError>
                  </div>
                  <div>
                    <FieldLabel htmlFor={`${uid}-timeout`} hint="5 – 600 s">
                      Request timeout
                    </FieldLabel>
                    <div className="relative">
                      <Input
                        id={`${uid}-timeout`}
                        inputMode="numeric"
                        value={form.timeout}
                        onChange={(e) => set("timeout", e.target.value)}
                        aria-invalid={!!fieldErrors.timeout_seconds}
                        className="pr-14 font-mono"
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-xs text-zinc-400">sec</span>
                    </div>
                    <FieldError>{fieldErrors.timeout_seconds}</FieldError>
                  </div>
                  <fieldset>
                    <legend className="mb-1.5 text-[11px] font-black uppercase tracking-wider">Retries per target</legend>
                    <div className="flex" role="radiogroup">
                      {[0, 1, 2, 3].map((n) => (
                        <button
                          key={n}
                          type="button"
                          role="radio"
                          aria-checked={form.retries === n}
                          onClick={() => set("retries", n)}
                          className={cn(
                            "-ml-px h-9 flex-1 cursor-pointer border font-mono text-sm font-bold first:ml-0 focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-[#ff4e26]",
                            form.retries === n
                              ? "relative z-[1] border-zinc-900 bg-zinc-900 text-white dark:border-zinc-300 dark:bg-zinc-200 dark:text-zinc-900"
                              : "border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
                          )}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1 text-[10px] text-zinc-400">{form.retries + 1} attempt{form.retries ? "s" : ""} before moving to the next fallback</p>
                  </fieldset>
                </div>

                <div>
                  <FieldLabel hint="sent with every request">Extra headers</FieldLabel>
                  <HeadersEditor rows={form.headers} onChange={(rows) => set("headers", rows)} max={config.limits.max_extra_headers || MAX_HEADERS_FALLBACK} />
                </div>

                <div>
                  <FieldLabel htmlFor={`${uid}-body`} optional hint="merged into every request body">
                    Extra body (JSON)
                  </FieldLabel>
                  <Textarea
                    id={`${uid}-body`}
                    value={form.extraBody}
                    onChange={(e) => set("extraBody", e.target.value)}
                    placeholder={'{\n  "provider": { "require_parameters": true }\n}'}
                    spellCheck={false}
                    rows={4}
                    aria-invalid={!!extra.error}
                    className={cn("font-mono text-xs", extra.error && "border-red-400 dark:border-red-700")}
                  />
                  {extra.error ? (
                    <FieldError>{extra.error}</FieldError>
                  ) : (
                    form.extraBody.trim() && (
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                        <Check size={11} aria-hidden /> Valid JSON · {Object.keys(extra.value).length} key{Object.keys(extra.value).length === 1 ? "" : "s"}
                      </p>
                    )
                  )}
                </div>

                <div className="flex items-center justify-between gap-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-wider">Enabled</p>
                    <p className="text-[11px] text-zinc-500">Disabled endpoints stay configured but routing skips them.</p>
                  </div>
                  <Switch label="Endpoint enabled" checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
                </div>
              </div>
            </Disclosure>
          </section>
        </div>
          <Confirm
            open={confirmDiscard}
            onOpenChange={setConfirmDiscard}
            title="Discard changes?"
            actions={
              <>
                <Button variant="outline" onClick={() => setConfirmDiscard(false)}>
                  Keep editing
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setConfirmDiscard(false)
                    onClose()
                  }}
                >
                  Discard
                </Button>
              </>
            }
          >
            {tokenDirty ? "Your edits, including the token you typed, will be lost." : "Your edits will be lost."}
          </Confirm>
      </Sheet>
  )
}
