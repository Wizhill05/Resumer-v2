"use client"

import { AlertTriangle, ArrowRight, AudioLines, Crown, FileText, PackageOpen } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { LlmEndpoint, LlmRole, LlmRoleId } from "./types"
import { HealthDot, computeHealth } from "./HealthBadge"
import { useNow } from "./format"

export const ROLE_ICON: Record<LlmRoleId, LucideIcon> = {
  default: FileText,
  pro: Crown,
  utility: PackageOpen,
  audio: AudioLines,
}

export function TargetChain({
  targets,
  endpoints,
  inherited,
  compact,
}: {
  targets: { endpoint_id: string; model: string; endpoint_name?: string }[]
  endpoints: LlmEndpoint[]
  inherited?: boolean
  compact?: boolean
}) {
  const now = useNow()
  return (
    <ol className="relative space-y-2.5">
      {targets.map((t, i) => {
        const ep = endpoints.find((e) => e.id === t.endpoint_id)
        const health = ep ? computeHealth(ep, now) : null
        const last = i === targets.length - 1
        return (
          <li key={`${t.endpoint_id}:${t.model}:${i}`} className="relative flex gap-2.5">
            {!last && (
              <span aria-hidden className="absolute left-[11px] top-6 h-[calc(100%-0.75rem)] w-px border-l-2 border-dotted border-zinc-300 dark:border-zinc-600" />
            )}
            <span
              aria-hidden
              className={cn(
                "relative z-[1] inline-flex h-6 w-6 shrink-0 items-center justify-center border-2 font-mono text-[11px] font-black",
                inherited
                  ? "border-dashed border-zinc-400 bg-transparent text-zinc-500 dark:border-zinc-600"
                  : i === 0
                    ? "border-zinc-900 bg-[#ff4e26] text-white dark:border-zinc-500"
                    : "border-zinc-900 bg-white text-zinc-900 dark:border-zinc-500 dark:bg-zinc-900 dark:text-zinc-100",
              )}
            >
              {i + 1}
            </span>
            <div className={cn("min-w-0 flex-1", inherited && "opacity-70")}>
              <p className="flex items-center gap-1.5 text-xs font-black">
                <span className={cn("truncate", !ep && "text-red-600 line-through")}>{ep?.name ?? t.endpoint_name ?? "Missing endpoint"}</span>
                {health && <HealthDot kind={health.kind} className="h-1.5 w-1.5" />}
                {health && health.kind !== "ok" && health.kind !== "unknown" && (
                  <span className="font-mono text-[9px] font-bold uppercase text-zinc-500">{health.label}</span>
                )}
                {!compact && <span className="sr-only">{i === 0 ? "(primary)" : `(fallback ${i})`}</span>}
              </p>
              <p className="truncate font-mono text-[11px] text-zinc-600 dark:text-zinc-400" title={t.model}>
                {t.model}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function RoleCard({
  role,
  index,
  endpoints,
  onEdit,
  defaultLabel,
}: {
  role: LlmRole
  index: number
  endpoints: LlmEndpoint[]
  onEdit: () => void
  defaultLabel: string
}) {
  const Icon = ROLE_ICON[role.role]
  const eff = role.effective_targets
  const inherited = role.targets.length === 0 && eff.length > 0 && eff.every((t) => t.inherited)
  const unconfigured = eff.length === 0
  const overrides = [
    role.temperature !== null ? `temp ${role.temperature}` : null,
    role.max_output_tokens !== null ? `${role.max_output_tokens.toLocaleString()} tok` : null,
  ].filter(Boolean)

  return (
    <section
      aria-labelledby={`role-${role.role}-title`}
      className={cn(
        "panel-strong flex min-w-0 flex-col",
        unconfigured && role.required && "border-red-600! shadow-[3px_3px_0_#dc2626]! dark:border-red-500! dark:shadow-[3px_3px_0_#7f1d1d]!",
      )}
    >
      <header className="flex items-start gap-2.5 border-b border-zinc-200 px-4 pb-3 pt-3.5 dark:border-zinc-700/70">
        <span
          aria-hidden
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center border-2 border-zinc-900 bg-[#fbfbf3] text-zinc-900 dark:border-zinc-500 dark:bg-zinc-800 dark:text-zinc-100"
        >
          <Icon size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-zinc-400">
            {String(index + 1).padStart(2, "0")} · {role.role}
            {role.required && <span className="ml-1.5 text-[#ff4e26]">required</span>}
          </p>
          <h4 id={`role-${role.role}-title`} className="text-[13px] font-black uppercase leading-tight tracking-wide">
            {role.label}
          </h4>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-3 px-4 py-3.5">
        <p className="line-clamp-2 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400" title={role.used_for.join(", ")}>
          {role.description || role.used_for.join(", ")}
        </p>

        {unconfigured ? (
          <div
            className={cn(
              "flex flex-1 flex-col items-start justify-center gap-1 border-2 border-dashed px-3 py-4",
              role.required ? "border-red-300 dark:border-red-900" : "border-zinc-300 dark:border-zinc-700",
            )}
          >
            <p className={cn("text-xs font-black uppercase", role.required ? "text-red-600 dark:text-red-400" : "text-zinc-500")}>
              {role.required ? "Not configured" : role.role === "audio" ? "Off" : "No targets"}
            </p>
            <p className="text-[11px] text-zinc-500">
              {role.required
                ? "Generation is blocked until a model is routed here."
                : role.role === "audio"
                  ? "Voice notes in support are skipped."
                  : `Will inherit ${defaultLabel} once it is set.`}
            </p>
          </div>
        ) : (
          <div className="flex-1">
            {inherited && (
              <p className="mb-2 inline-flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                ↳ Inherits {defaultLabel}
              </p>
            )}
            <TargetChain targets={eff} endpoints={endpoints} inherited={inherited} />
          </div>
        )}

        {role.issues.length > 0 && (
          <ul className="space-y-1 border-l-[3px] border-amber-500 bg-amber-50 px-2.5 py-1.5 dark:bg-amber-950/30">
            {role.issues.map((issue) => (
              <li key={issue} className="flex gap-1.5 text-[11px] leading-snug text-amber-900 dark:text-amber-200">
                <AlertTriangle size={12} aria-hidden className="mt-px shrink-0" />
                {issue}
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-zinc-200 px-4 py-2.5 dark:border-zinc-700/70">
        <span className="truncate font-mono text-[10px] text-zinc-400">{overrides.length ? overrides.join(" · ") : "endpoint defaults"}</span>
        <Button size="xs" variant="outline" onClick={onEdit} aria-label={`Edit routing for ${role.label}`}>
          Edit <ArrowRight size={12} />
        </Button>
      </footer>
    </section>
  )
}
