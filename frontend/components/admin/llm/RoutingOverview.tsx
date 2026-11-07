"use client"

import type { LlmConfigResponse, LlmRoleId } from "./types"
import { ROLE_ORDER } from "./types"
import { RoleCard } from "./RoleCard"

export function RoutingOverview({ config, onEditRole }: { config: LlmConfigResponse; onEditRole: (role: LlmRoleId) => void }) {
  const roles = ROLE_ORDER.map((id) => config.roles.find((r) => r.role === id)).filter((r) => r !== undefined)
  const defaultLabel = config.roles.find((r) => r.role === "default")?.label ?? "Resume generation"
  return (
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
      {roles.map((role, i) => (
        <RoleCard
          key={role.role}
          role={role}
          index={i}
          endpoints={config.endpoints}
          defaultLabel={defaultLabel}
          onEdit={() => onEditRole(role.role)}
        />
      ))}
    </div>
  )
}
