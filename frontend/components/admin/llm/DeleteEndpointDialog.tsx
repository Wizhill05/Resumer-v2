"use client"

import { useId, useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { LlmEndpoint, LlmRole, LlmRoleId } from "./types"
import { useDeleteEndpoint } from "./hooks"
import { ApiError, errorMessage } from "./api"
import { Callout, Confirm, Spinner } from "./primitives"

export function DeleteEndpointDialog({
  endpoint,
  roles,
  onClose,
  onDeleted,
}: {
  endpoint: LlmEndpoint
  roles: LlmRole[]
  onClose: () => void
  onDeleted: (message: string) => void
}) {
  const uid = useId()
  const del = useDeleteEndpoint()
  const [typed, setTyped] = useState("")
  // A 409 race (endpoint got routed after the page loaded) switches us to the forced variant.
  const [raceRoles, setRaceRoles] = useState<LlmRoleId[] | null>(null)
  const inUse = raceRoles ?? endpoint.used_by_roles
  const forced = inUse.length > 0
  const labelOf = (id: LlmRoleId) => roles.find((r) => r.role === id)?.label ?? id
  const nameOk = typed.trim() === endpoint.name
  const breaksDefault = inUse.includes("default") && (roles.find((r) => r.role === "default")?.targets.length ?? 0) <= 1

  const submit = () => {
    del.mutate(
      { id: endpoint.id, force: forced },
      {
        onSuccess: (res) => {
          const removed = res.removed_from_roles.map(labelOf)
          onDeleted(`Deleted “${endpoint.name}”${removed.length ? ` and removed it from ${removed.join(", ")}` : ""}.`)
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === "endpoint_in_use") {
            setRaceRoles(err.roles.length ? err.roles : ["default"])
            del.reset()
          }
        },
      },
    )
  }

  return (
    <Confirm
      open
      tone="danger"
      onOpenChange={(open) => !open && !del.isPending && onClose()}
      title={`Delete “${endpoint.name}”?`}
      actions={
        <>
          <Button variant="outline" onClick={onClose} disabled={del.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={del.isPending || (forced && !nameOk)}>
            {del.isPending ? <Spinner /> : <Trash2 size={14} />}
            {forced ? "Remove & delete" : "Delete"}
          </Button>
        </>
      }
    >
      {forced ? (
        <>
          <p>
            This endpoint is routed in{" "}
            {inUse.map((r, i) => (
              <span key={r}>
                <strong className="text-zinc-900 dark:text-white">{labelOf(r)}</strong>
                {i < inUse.length - 2 ? ", " : i === inUse.length - 2 ? " and " : ""}
              </span>
            ))}
            . Deleting it removes it from {inUse.length > 1 ? "those tasks" : "that task"}; remaining fallbacks move up.
          </p>
          {breaksDefault && (
            <Callout tone="danger">It is the only target for resume generation. Generation stops until you route another model.</Callout>
          )}
          <div>
            <label htmlFor={`${uid}-confirm`} className="mb-1.5 block text-xs">
              Type <span className="font-mono font-bold text-zinc-900 dark:text-white">{endpoint.name}</span> to confirm
            </label>
            <Input id={`${uid}-confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono" />
          </div>
        </>
      ) : (
        <p>The connection and its stored token are removed. No task routes to it, so nothing else changes.</p>
      )}
      {del.isError && <Callout tone="danger">{errorMessage(del.error)}</Callout>}
    </Confirm>
  )
}
