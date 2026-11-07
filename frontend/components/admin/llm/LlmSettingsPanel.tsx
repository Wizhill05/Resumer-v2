"use client"

import { useState } from "react"
import { ArrowRight, CheckCircle2, Plus, RefreshCw, TriangleAlert, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { LlmConfigResponse, LlmEndpoint, LlmRoleId } from "./types"
import { useLlmConfig } from "./hooks"
import { errorMessage } from "./api"
import { RoutingOverview } from "./RoutingOverview"
import { EndpointList } from "./EndpointList"
import { EndpointEditorSheet, type EditorTarget } from "./EndpointEditorSheet"
import { RoleEditorDialog } from "./RoleEditorDialog"
import { DeleteEndpointDialog } from "./DeleteEndpointDialog"
import { Spinner } from "./primitives"

type Notice = { text: string; tone: "ok" | "warn" }

function SectionHeading({
  code,
  title,
  description,
  action,
}: {
  code: string
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 border-b-2 border-zinc-900 pb-3 dark:border-zinc-700 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[#ff4e26]">{code}</p>
        <h3 className="text-base font-black uppercase tracking-wide text-black dark:text-white">{title}</h3>
        <p className="mt-0.5 max-w-2xl text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
      </div>
      {action}
    </div>
  )
}

function StatusBanner({
  config,
  onAdd,
  onEditDefault,
}: {
  config: LlmConfigResponse
  onAdd: () => void
  onEditDefault: () => void
}) {
  const def = config.roles.find((r) => r.role === "default")
  const pro = config.roles.find((r) => r.role === "pro")
  const primary = def?.effective_targets[0]
  const fallbacks = Math.max(0, (def?.effective_targets.length ?? 0) - 1)
  const proPrimary = pro?.effective_targets[0]
  const enabled = config.endpoints.filter((e) => e.enabled).length
  const noEndpoints = config.endpoints.length === 0

  return (
    <div
      role="status"
      className={cn(
        "flex flex-col border-2 sm:flex-row",
        config.ready
          ? "border-zinc-900 bg-white shadow-[3px_3px_0_#18181b] dark:border-zinc-600 dark:bg-[#242427] dark:shadow-[3px_3px_0_#3f3f46]"
          : "border-red-600 bg-red-50 shadow-[3px_3px_0_#dc2626] dark:border-red-500 dark:bg-red-950/30 dark:shadow-[3px_3px_0_#7f1d1d]",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2.5 px-4 py-3 sm:w-52 sm:shrink-0 sm:flex-col sm:items-start sm:justify-center sm:border-r-2",
          config.ready ? "bg-emerald-50 dark:bg-emerald-950/30 sm:border-zinc-900 dark:sm:border-zinc-600" : "sm:border-red-600 dark:sm:border-red-500",
        )}
      >
        {config.ready ? (
          <CheckCircle2 size={22} aria-hidden className="shrink-0 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <TriangleAlert size={22} aria-hidden className="shrink-0 text-red-600 dark:text-red-400" />
        )}
        <div>
          <p className={cn("text-sm font-black uppercase tracking-wide", config.ready ? "text-emerald-800 dark:text-emerald-300" : "text-red-700 dark:text-red-300")}>
            {config.ready ? "Routing ready" : "Not configured"}
          </p>
          <p className="font-mono text-[10px] text-zinc-500">
            {enabled}/{config.endpoints.length} endpoint{config.endpoints.length === 1 ? "" : "s"} enabled
          </p>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3 px-4 py-3 md:flex-row md:items-center">
        {config.ready && primary ? (
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
              <span className="font-bold">{def?.label}</span>
              <ArrowRight size={14} aria-hidden className="text-zinc-400" />
              <span className="font-black">{primary.endpoint_name}</span>
              <span className="min-w-0 truncate font-mono text-xs text-zinc-600 dark:text-zinc-400">{primary.model}</span>
              {fallbacks > 0 && (
                <span className="border border-zinc-300 px-1.5 font-mono text-[10px] text-zinc-500 dark:border-zinc-700">
                  +{fallbacks} fallback{fallbacks > 1 ? "s" : ""}
                </span>
              )}
            </p>
            {proPrimary && (
              <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                <span className="font-semibold">{pro?.label}</span>
                <ArrowRight size={12} aria-hidden />
                <span className="font-bold text-zinc-700 dark:text-zinc-300">{proPrimary.endpoint_name}</span>
                <span className="truncate font-mono">{proPrimary.model}</span>
                {proPrimary.inherited && <span className="font-mono text-[10px] uppercase">(inherited)</span>}
              </p>
            )}
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-red-900 dark:text-red-200">
              {noEndpoints ? "Add an endpoint to start generating resumes." : "Resume generation has no usable model."}
            </p>
            <p className="mt-0.5 text-xs text-red-800/80 dark:text-red-300/80">
              {noEndpoints
                ? "Generations fail with “LLM not configured” until an endpoint is routed to Resume generation."
                : (def?.issues[0] ?? "Route an enabled endpoint + model to Resume generation.")}
            </p>
          </div>
        )}
        {!config.ready && (
          <Button className="shrink-0 self-start md:self-center" onClick={noEndpoints ? onAdd : onEditDefault}>
            {noEndpoints ? (
              <>
                <Plus size={15} /> Add endpoint
              </>
            ) : (
              <>
                Fix routing <ArrowRight size={14} />
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading LLM configuration">
      <div className="soft-skeleton h-[74px]" />
      <div>
        <div className="soft-skeleton mb-4 h-14" />
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="soft-skeleton h-56" />
          ))}
        </div>
      </div>
      <div className="space-y-4">
        <div className="soft-skeleton h-14" />
        <div className="soft-skeleton h-36" />
        <div className="soft-skeleton h-36" />
      </div>
    </div>
  )
}

export function LlmSettingsPanel() {
  const { data: config, error, isLoading, isFetching, refetch } = useLlmConfig()
  const [editor, setEditor] = useState<(EditorTarget & { session: number }) | null>(null)
  const [roleEditing, setRoleEditing] = useState<LlmRoleId | null>(null)
  const [deleting, setDeleting] = useState<LlmEndpoint | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  const openEditor = (endpoint: LlmEndpoint | null) => {
    setNotice(null)
    setEditor((prev) => ({ endpoint, session: (prev?.session ?? 0) + 1 }))
  }

  if (isLoading) return <LoadingState />

  if (!config) {
    return (
      <div className="panel-strong flex flex-col items-start gap-3 p-6" role="alert">
        <TriangleAlert size={22} aria-hidden className="text-red-600" />
        <div>
          <p className="text-sm font-black uppercase tracking-wide">Couldn&apos;t load LLM configuration</p>
          <p className="mt-1 text-xs text-zinc-500">{errorMessage(error)}</p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Spinner /> : <RefreshCw size={14} />} Retry
        </Button>
      </div>
    )
  }

  const editingRole = roleEditing ? config.roles.find((r) => r.role === roleEditing) : undefined

  return (
    <div className="space-y-10 pixel-enter">
      <div className="space-y-3">
        {error && (
          <div
            className="flex flex-wrap items-center justify-between gap-2 border border-amber-500 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
            role="status"
          >
            <span>Couldn&apos;t refresh — showing the last loaded configuration. {errorMessage(error)}</span>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? <Spinner /> : <RefreshCw size={12} />} Retry
            </Button>
          </div>
        )}
        <StatusBanner config={config} onAdd={() => openEditor(null)} onEditDefault={() => setRoleEditing("default")} />
        {notice && (
          <div
            role="status"
            className={cn(
              "flex items-start gap-2 border-l-4 px-3 py-2 text-xs font-semibold",
              notice.tone === "ok"
                ? "border-emerald-600 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                : "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
            )}
          >
            {notice.tone === "ok" ? <CheckCircle2 size={14} aria-hidden className="mt-px shrink-0" /> : <TriangleAlert size={14} aria-hidden className="mt-px shrink-0" />}
            <span className="flex-1">{notice.text}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="cursor-pointer opacity-60 hover:opacity-100">
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      <section aria-label="Routing">
        <SectionHeading
          code="A / Routing"
          title="Who handles what"
          description="Each task tries its targets top to bottom and fails over on errors. Pro and Imports inherit Resume generation while empty."
        />
        <RoutingOverview config={config} onEditRole={setRoleEditing} />
      </section>

      <section aria-label="Endpoints">
        <SectionHeading
          code={`B / Endpoints · ${config.endpoints.length}`}
          title="Connections"
          description="OpenAI-compatible APIs. Tokens are encrypted at rest and never shown again after saving."
          action={
            config.endpoints.length > 0 && (
              <Button className="self-start sm:self-auto" onClick={() => openEditor(null)}>
                <Plus size={15} /> Add endpoint
              </Button>
            )
          }
        />
        <EndpointList
          endpoints={config.endpoints}
          roles={config.roles}
          onAdd={() => openEditor(null)}
          onEdit={(ep) => openEditor(ep)}
          onDelete={(ep) => setDeleting(ep)}
        />
      </section>

      {editor && (
        <EndpointEditorSheet
          key={editor.session}
          target={editor}
          config={config}
          onClose={() => setEditor(null)}
          onSaved={(text, tone = "ok") => {
            setEditor(null)
            setNotice({ text, tone })
          }}
        />
      )}

      {editingRole && (
        <RoleEditorDialog
          key={editingRole.role}
          role={editingRole}
          config={config}
          onClose={() => setRoleEditing(null)}
          onSaved={(text) => {
            setRoleEditing(null)
            setNotice({ text, tone: "ok" })
          }}
        />
      )}

      {deleting && (
        <DeleteEndpointDialog
          key={deleting.id}
          endpoint={deleting}
          roles={config.roles}
          onClose={() => setDeleting(null)}
          onDeleted={(text) => {
            setDeleting(null)
            setNotice({ text, tone: "ok" })
          }}
        />
      )}
    </div>
  )
}
