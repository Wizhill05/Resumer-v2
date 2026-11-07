"use client"

import { useId, useMemo, useState } from "react"
import { AlertTriangle, ArrowDown, ArrowUp, ChevronsUpDown, Info, Plus, Undo2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { LlmConfigResponse, LlmRole, LlmRoleTarget, ModelKind } from "./types"
import { useUpdateRole } from "./hooks"
import { errorMessage } from "./api"
import { Callout, FieldError, FieldLabel, Modal, Spinner, selectCls } from "./primitives"
import { ModelPicker } from "./ModelPicker"
import { ROLE_ICON } from "./RoleCard"

type Row = LlmRoleTarget & { key: number }
type Issue = { tone: "danger" | "warn" | "info"; text: string; blocking?: boolean }

let rowKey = 0
const AUDIO_KINDS: ModelKind[] = ["audio", "chat"]

function parseOptionalNumber(raw: string, min: number, max: number, integer: boolean): { value: number | null; error: string | null } {
  const t = raw.trim()
  if (!t) return { value: null, error: null }
  const n = Number(t)
  if (!Number.isFinite(n)) return { value: null, error: "Enter a number" }
  if (integer && !Number.isInteger(n)) return { value: null, error: "Whole numbers only" }
  if (n < min || n > max) return { value: null, error: `Between ${min} and ${max}` }
  return { value: n, error: null }
}

export function RoleEditorDialog({
  role,
  config,
  onClose,
  onSaved,
}: {
  role: LlmRole
  config: LlmConfigResponse
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const uid = useId()
  const Icon = ROLE_ICON[role.role]
  const max = config.limits.max_targets_per_role
  const endpoints = config.endpoints
  const defaultRole = config.roles.find((r) => r.role === "default")
  const [rows, setRows] = useState<Row[]>(() => role.targets.map((t) => ({ ...t, key: ++rowKey })))
  const [openPicker, setOpenPicker] = useState<number | null>(null)
  const [temperature, setTemperature] = useState(role.temperature === null ? "" : String(role.temperature))
  const [maxTokens, setMaxTokens] = useState(role.max_output_tokens === null ? "" : String(role.max_output_tokens))
  const save = useUpdateRole()

  const temp = parseOptionalNumber(temperature, 0, 2, false)
  const tokens = parseOptionalNumber(maxTokens, 64, 65536, true)

  const issues = useMemo<Issue[]>(() => {
    const out: Issue[] = []
    if (rows.length === 0) {
      if (role.required) out.push({ tone: "danger", text: "No targets: resume generation will fail until one is added." })
      else if (role.inherits_from) out.push({ tone: "info", text: `Empty: inherits ${defaultRole?.label ?? "Resume generation"}'s targets.` })
      else out.push({ tone: "info", text: "Empty: this task is switched off." })
    }
    const seen = new Set<string>()
    rows.forEach((r, i) => {
      const n = i === 0 ? "Primary" : `Fallback ${i}`
      const ep = endpoints.find((e) => e.id === r.endpoint_id)
      if (!ep) out.push({ tone: "danger", text: `${n}: choose an endpoint.`, blocking: true })
      if (!r.model.trim()) out.push({ tone: "danger", text: `${n}: choose a model.`, blocking: true })
      const k = `${r.endpoint_id}\u0000${r.model.trim()}`
      if (ep && r.model.trim() && seen.has(k)) out.push({ tone: "danger", text: `${n} duplicates an earlier target.`, blocking: true })
      seen.add(k)
      if (ep && !ep.enabled) out.push({ tone: "warn", text: `${n}: “${ep.name}” is disabled and will be skipped.` })
      if (ep?.api_key_status === "undecryptable") out.push({ tone: "warn", text: `${n}: “${ep.name}” needs its token re-entered.` })
      if (role.role === "audio" && ep) {
        const kind = ep.models.find((m) => m.id === r.model)?.kind
        if (kind && kind !== "audio" && !ep.models.find((m) => m.id === r.model)?.capabilities.includes("audio_input")) {
          out.push({ tone: "warn", text: `${n}: “${r.model}” isn't flagged as audio-capable. Make sure it accepts input_audio.` })
        }
      }
    })
    if (rows.length > 0 && rows.every((r) => endpoints.find((e) => e.id === r.endpoint_id)?.enabled === false)) {
      out.push({ tone: "danger", text: "Every target is disabled, so nothing will run." })
    }
    return out
  }, [rows, endpoints, role, defaultRole])

  const blocking = issues.some((i) => i.blocking) || !!temp.error || !!tokens.error

  const update = (key: number, patch: Partial<LlmRoleTarget>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const move = (from: number, to: number) =>
    setRows((rs) => {
      const next = [...rs]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  const addRow = () => {
    const used = new Set(rows.map((r) => r.endpoint_id))
    const ep = endpoints.find((e) => e.enabled && !used.has(e.id)) ?? endpoints.find((e) => e.enabled) ?? endpoints[0]
    const key = ++rowKey
    setRows((rs) => [...rs, { key, endpoint_id: ep?.id ?? "", model: ep?.default_model ?? "" }])
    if (ep && !ep.default_model) setOpenPicker(key)
  }

  const submit = () => {
    save.mutate(
      {
        role: role.role,
        body: {
          targets: rows.map(({ endpoint_id, model }) => ({ endpoint_id, model: model.trim() })),
          temperature: temp.value,
          max_output_tokens: tokens.value,
        },
      },
      { onSuccess: () => onSaved(`Saved routing for ${role.label}.`) },
    )
  }

  return (
    <Modal
      open
      onRequestClose={() => !save.isPending && onClose()}
      eyebrow={
        <span className="inline-flex items-center gap-1.5">
          <Icon size={11} aria-hidden /> Routing · {role.role}
        </span>
      }
      title={role.label}
      description={role.used_for.length ? `Used for: ${role.used_for.join(", ")}` : role.description}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
          {save.isError && <p className="text-xs font-semibold text-red-600 sm:mr-auto">{errorMessage(save.error)}</p>}
          <div className="flex gap-2 sm:ml-auto">
            <Button variant="outline" className="flex-1 sm:flex-none" onClick={onClose} disabled={save.isPending}>
              Cancel
            </Button>
            <Button className="flex-1 sm:flex-none" onClick={submit} disabled={blocking || save.isPending}>
              {save.isPending && <Spinner />} Save routing
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-6 px-4 py-5 sm:px-5">
        <section aria-labelledby={`${uid}-targets`}>
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h3 id={`${uid}-targets`} className="text-xs font-black uppercase tracking-wider">
              Targets <span className="font-mono font-medium text-zinc-400">tried top to bottom</span>
            </h3>
            <span className="font-mono text-[10px] text-zinc-400">
              {rows.length}/{max}
            </span>
          </div>

          {endpoints.length === 0 && <Callout tone="warn">Add an endpoint first; targets point at an endpoint + model.</Callout>}

          <ol className="space-y-2.5">
            {rows.map((row, i) => {
              const ep = endpoints.find((e) => e.id === row.endpoint_id)
              const pickerOpen = openPicker === row.key
              return (
                <li key={row.key} className="border-2 border-zinc-900 bg-white dark:border-zinc-600 dark:bg-zinc-900">
                  <div className="flex flex-wrap items-center gap-2 p-2.5 sm:flex-nowrap">
                    <span
                      aria-hidden
                      className={cn(
                        "inline-flex h-9 w-9 shrink-0 flex-col items-center justify-center border-2 border-zinc-900 font-mono leading-none dark:border-zinc-500",
                        i === 0 ? "bg-[#ff4e26] text-white" : "bg-[#fbfbf3] dark:bg-zinc-800",
                      )}
                    >
                      <span className="text-xs font-black">{i + 1}</span>
                      <span className="mt-0.5 text-[7px] font-bold uppercase">{i === 0 ? "main" : "fb"}</span>
                    </span>
                    <select
                      aria-label={`${i === 0 ? "Primary" : `Fallback ${i}`} endpoint`}
                      value={row.endpoint_id}
                      onChange={(e) => {
                        const next = endpoints.find((x) => x.id === e.target.value)
                        const keep = next?.models.some((m) => m.id === row.model)
                        update(row.key, { endpoint_id: e.target.value, model: keep ? row.model : (next?.default_model ?? "") })
                      }}
                      className={cn(selectCls, "min-w-0 flex-1 sm:max-w-[13rem]")}
                    >
                      {!ep && <option value="">Choose endpoint…</option>}
                      {endpoints.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                          {e.enabled ? "" : " (disabled)"}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-expanded={pickerOpen}
                      aria-label={`${i === 0 ? "Primary" : `Fallback ${i}`} model: ${row.model || "not chosen"}`}
                      disabled={!ep}
                      onClick={() => setOpenPicker(pickerOpen ? null : row.key)}
                      className={cn(
                        "flex h-9 min-w-0 basis-full cursor-pointer items-center gap-2 border px-3 text-left font-mono text-xs transition-colors focus-visible:outline-2 focus-visible:outline-[#ff4e26] disabled:cursor-not-allowed disabled:opacity-50 sm:basis-auto sm:flex-1",
                        pickerOpen ? "border-zinc-900 bg-zinc-100 dark:border-zinc-400 dark:bg-zinc-800" : "border-zinc-300 hover:border-zinc-500 dark:border-zinc-700",
                        !row.model && "text-zinc-400",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{row.model || "Choose model…"}</span>
                      <ChevronsUpDown size={13} aria-hidden className="shrink-0 text-zinc-400" />
                    </button>
                    <div className="ml-auto flex shrink-0 gap-1">
                      <Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}>
                        <ArrowUp size={14} />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, i + 1)}>
                        <ArrowDown size={14} />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Remove target"
                        className="hover:text-red-600"
                        onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
                      >
                        <X size={14} />
                      </Button>
                    </div>
                  </div>
                  {pickerOpen && ep && (
                    <div className="border-t-2 border-zinc-900 p-2.5 dark:border-zinc-600">
                      <ModelPicker
                        autoFocus
                        label={`Model for ${ep.name}`}
                        models={ep.models}
                        value={row.model || null}
                        defaultKinds={role.role === "audio" ? AUDIO_KINDS : undefined}
                        listClassName="max-h-60"
                        onChange={(model) => {
                          update(row.key, { model })
                          setOpenPicker(null)
                        }}
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ol>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {rows.length < max && endpoints.length > 0 && (
              <Button size="sm" variant="outline" onClick={addRow}>
                <Plus size={13} /> {rows.length === 0 ? "Add primary" : "Add fallback"}
              </Button>
            )}
            {role.inherits_from && rows.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setRows([])}>
                <Undo2 size={13} /> Clear to inherit from {defaultRole?.label ?? "Resume generation"}
              </Button>
            )}
          </div>

          {role.role === "audio" && (
            <p className="mt-3 flex gap-1.5 text-[11px] leading-snug text-zinc-500">
              <Info size={12} aria-hidden className="mt-px shrink-0" />
              <span>
                Model must accept <code className="font-mono">input_audio</code> (e.g. gpt-4o-audio-preview, gemini via an
                OpenAI-compatible gateway).
              </span>
            </p>
          )}
        </section>

        {issues.length > 0 && (
          <ul className="space-y-1.5" aria-live="polite">
            {issues.map((issue) => (
              <li
                key={issue.text}
                className={cn(
                  "flex gap-2 border-l-[3px] px-2.5 py-1.5 text-xs",
                  issue.tone === "danger" && "border-red-600 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200",
                  issue.tone === "warn" && "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
                  issue.tone === "info" && "border-zinc-400 bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
                )}
              >
                {issue.tone === "info" ? <Info size={13} aria-hidden className="mt-px shrink-0" /> : <AlertTriangle size={13} aria-hidden className="mt-px shrink-0" />}
                {issue.text}
              </li>
            ))}
          </ul>
        )}

        <section aria-labelledby={`${uid}-overrides`} className="border-t border-zinc-200 pt-5 dark:border-zinc-700">
          <h3 id={`${uid}-overrides`} className="text-xs font-black uppercase tracking-wider">
            Overrides <span className="font-mono font-medium text-zinc-400">blank = each endpoint&apos;s default</span>
          </h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor={`${uid}-temp`} hint="0 – 2">
                Temperature
              </FieldLabel>
              <Input
                id={`${uid}-temp`}
                inputMode="decimal"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                placeholder="inherit"
                aria-invalid={!!temp.error}
                className="font-mono"
              />
              <FieldError>{temp.error}</FieldError>
            </div>
            <div>
              <FieldLabel htmlFor={`${uid}-tokens`} hint="64 – 65536">
                Max output tokens
              </FieldLabel>
              <Input
                id={`${uid}-tokens`}
                inputMode="numeric"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                placeholder="inherit"
                aria-invalid={!!tokens.error}
                className="font-mono"
              />
              <FieldError>{tokens.error}</FieldError>
            </div>
          </div>
        </section>
      </div>
    </Modal>
  )
}
