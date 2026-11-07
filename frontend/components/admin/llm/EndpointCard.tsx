"use client"

import { useState } from "react"
import { FlaskConical, KeyRound, Pencil, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { LlmEndpoint, LlmModelsRefreshResponse, LlmRole } from "./types"
import { HealthBadge, computeHealth } from "./HealthBadge"
import { TestResultPanel } from "./TestResultPanel"
import { useRefreshModels, useToggleEndpoint } from "./hooks"
import { describeError } from "./errors"
import { formatLatency, relativeTime, useNow } from "./format"
import { errorMessage } from "./api"
import { Callout, Spinner, Switch } from "./primitives"
import { STRUCTURED_OUTPUT_MODES } from "./types"

const RAIL: Record<string, string> = {
  ok: "before:bg-emerald-500",
  error: "before:bg-red-500",
  token: "before:bg-red-500",
  cooling: "before:bg-amber-500",
  disabled: "before:bg-zinc-300 dark:before:bg-zinc-700",
  unknown: "before:bg-zinc-300 dark:before:bg-zinc-600",
}

function Stat({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <dt className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-400">{label}</dt>
      <dd className="mt-0.5 truncate text-xs font-bold text-zinc-800 dark:text-zinc-200">{children}</dd>
    </div>
  )
}

export function EndpointCard({
  endpoint,
  roles,
  onEdit,
  onDelete,
}: {
  endpoint: LlmEndpoint
  roles: LlmRole[]
  onEdit: () => void
  onDelete: () => void
}) {
  const now = useNow()
  const [testing, setTesting] = useState(false)
  const [refreshResult, setRefreshResult] = useState<LlmModelsRefreshResponse | null>(null)
  const refresh = useRefreshModels()
  const toggle = useToggleEndpoint()
  const health = computeHealth(endpoint, now)
  const routes = roles
    .map((r) => ({ role: r, pos: r.targets.findIndex((t) => t.endpoint_id === endpoint.id) }))
    .filter((x) => x.pos >= 0)
  const modeLabel = STRUCTURED_OUTPUT_MODES.find((m) => m.value === endpoint.structured_output_mode)?.label
  const chatCount = endpoint.models.filter((m) => m.kind === "chat").length

  return (
    <article
      aria-label={endpoint.name}
      className={cn(
        "panel-strong relative overflow-hidden transition-opacity before:absolute before:inset-y-0 before:left-0 before:w-1",
        RAIL[health.kind],
        !endpoint.enabled && "opacity-80",
      )}
    >
      <div className="flex flex-col gap-3 py-3.5 pl-5 pr-4 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h4 className={cn("truncate text-[15px] font-black tracking-tight", !endpoint.enabled && "text-zinc-500")}>{endpoint.name}</h4>
            <HealthBadge endpoint={endpoint} />
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-zinc-500" title={endpoint.base_url}>
            {endpoint.base_url}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
          <label className="mr-1 inline-flex cursor-pointer items-center gap-2 border-r border-zinc-200 pr-3 text-[10px] font-black uppercase tracking-wider text-zinc-500 dark:border-zinc-700">
            <Switch
              size="sm"
              label={`${endpoint.enabled ? "Disable" : "Enable"} ${endpoint.name}`}
              checked={endpoint.enabled}
              disabled={toggle.isPending}
              onCheckedChange={(enabled) => toggle.mutate({ id: endpoint.id, enabled })}
            />
            <span aria-hidden>{endpoint.enabled ? "On" : "Off"}</span>
          </label>
          <Button size="sm" variant={testing ? "default" : "outline"} onClick={() => setTesting((t) => !t)} aria-expanded={testing}>
            <FlaskConical size={13} /> Test
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            title="Refresh model list"
            aria-label={`Refresh models for ${endpoint.name}`}
            disabled={refresh.isPending}
            onClick={() => refresh.mutate(endpoint.id, { onSuccess: (r) => setRefreshResult(r), onError: () => setRefreshResult(null) })}
          >
            {refresh.isPending ? <Spinner size={13} /> : <RefreshCw size={13} />}
          </Button>
          <Button size="icon-sm" variant="outline" title="Edit" aria-label={`Edit ${endpoint.name}`} onClick={onEdit}>
            <Pencil size={13} />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            title="Delete"
            aria-label={`Delete ${endpoint.name}`}
            className="text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
            onClick={onDelete}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-zinc-200 py-3 pl-5 pr-4 dark:border-zinc-700/70 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Default model" title={endpoint.default_model ?? undefined}>
          {endpoint.default_model ? <span className="font-mono">{endpoint.default_model}</span> : <span className="text-zinc-400">not set</span>}
        </Stat>
        <Stat label="Models" title={endpoint.models_fetched_at ? `Fetched ${new Date(endpoint.models_fetched_at).toLocaleString()}` : undefined}>
          {endpoint.models.length ? (
            <>
              {endpoint.models.length}
              {chatCount !== endpoint.models.length && <span className="font-medium text-zinc-500"> · {chatCount} chat</span>}
              <span className="font-mono font-medium text-zinc-400"> · {relativeTime(endpoint.models_fetched_at, now)}</span>
            </>
          ) : (
            <span className="text-zinc-400">none cached</span>
          )}
        </Stat>
        <Stat label="Last check" title={health.detail}>
          {endpoint.health.checked_at ? (
            <>
              {formatLatency(endpoint.health.latency_ms)}
              <span className="font-mono font-medium text-zinc-400"> · {relativeTime(endpoint.health.checked_at, now)}</span>
            </>
          ) : (
            <span className="text-zinc-400">never</span>
          )}
        </Stat>
        <Stat label="Output">{modeLabel}</Stat>
        <Stat label="Token">
          {endpoint.api_key_status === "undecryptable" ? (
            <span className="text-red-600 dark:text-red-400">unreadable</span>
          ) : endpoint.has_api_key ? (
            <span className="inline-flex items-center gap-1 font-mono">
              <KeyRound size={11} aria-hidden className="text-zinc-400" />
              {endpoint.api_key_hint ?? "set"}
            </span>
          ) : (
            <span className="text-zinc-400">none</span>
          )}
        </Stat>
      </dl>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-zinc-200 py-2 pl-5 pr-4 dark:border-zinc-700/70">
        <span className="mr-1 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-400">Routes</span>
        {routes.length === 0 ? (
          <span className="text-[11px] text-zinc-400">Not used by any task</span>
        ) : (
          routes.map(({ role, pos }) => (
            <span
              key={role.role}
              className={cn(
                "inline-flex items-center gap-1.5 border px-1.5 py-px text-[11px] font-bold",
                pos === 0
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-300 dark:bg-zinc-200 dark:text-zinc-900"
                  : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300",
              )}
            >
              {role.label}
              <span className="font-mono text-[10px] font-medium opacity-70">{pos === 0 ? "primary" : `fallback ${pos}`}</span>
            </span>
          ))
        )}
        {endpoint.health.status === "error" && endpoint.health.error && endpoint.enabled && (
          <span className="ml-auto max-w-full truncate text-[11px] text-red-600 dark:text-red-400" title={endpoint.health.error.message}>
            {describeError(endpoint.health.error).title}: {endpoint.health.error.message}
          </span>
        )}
      </div>

      {(toggle.isError || refresh.isError || (refreshResult && !refresh.isPending)) && (
        <div className="space-y-2 border-t border-zinc-200 px-4 py-2.5 dark:border-zinc-700/70" role="status">
          {toggle.isError && <Callout tone="danger">Couldn&apos;t change state: {errorMessage(toggle.error)}</Callout>}
          {refresh.isError && <Callout tone="danger">Refresh failed: {errorMessage(refresh.error)}</Callout>}
          {refreshResult &&
            !refresh.isPending &&
            (refreshResult.ok ? (
              <Callout tone="ok">
                Model list updated: {refreshResult.models.length} models.{" "}
                <button type="button" className="cursor-pointer underline" onClick={() => setRefreshResult(null)}>
                  Dismiss
                </button>
              </Callout>
            ) : (
              <Callout tone="danger" title={describeError(refreshResult.error).title}>
                {refreshResult.error?.message} {describeError(refreshResult.error).hint}
              </Callout>
            ))}
        </div>
      )}

      {testing && <TestResultPanel endpoint={endpoint} onClose={() => setTesting(false)} />}
    </article>
  )
}
