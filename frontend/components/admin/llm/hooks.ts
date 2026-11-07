"use client"

import { useCallback } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as api from "./api"
import type {
  LlmConfigResponse,
  LlmEndpointCreate,
  LlmEndpointUpdate,
  LlmProbeRequest,
  LlmRoleId,
  LlmRoleUpdate,
  LlmTestRequest,
} from "./types"

export const LLM_CONFIG_KEY = ["admin", "llm", "config"] as const
const ANALYTICS_KEY = ["admin", "analytics"] as const

export function useLlmConfig() {
  return useQuery<LlmConfigResponse, api.ApiError>({
    queryKey: LLM_CONFIG_KEY,
    queryFn: api.getLlmConfig,
    // Health/cooldowns change server-side; keep the page reasonably fresh without hammering.
    refetchInterval: 30_000,
    retry: (count, err) => count < 2 && !(err instanceof api.ApiError && [401, 403, 404].includes(err.status)),
  })
}

export function useInvalidateLlm() {
  const qc = useQueryClient()
  return useCallback(
    () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: LLM_CONFIG_KEY }),
        qc.invalidateQueries({ queryKey: ANALYTICS_KEY }),
      ]),
    [qc],
  )
}

/**
 * Calls that may carry a plaintext bearer token (create / update / probe) deliberately bypass
 * `useMutation`: React Query keeps mutation `variables` in its MutationCache, and tokens must never
 * be stored there. Callers track pending state locally and the token lives only in editor state.
 */
export function useSecretSafeActions() {
  const invalidate = useInvalidateLlm()
  return {
    probe: (body: LlmProbeRequest) => api.probe(body),
    createEndpoint: (body: LlmEndpointCreate) => api.createEndpoint(body),
    updateEndpoint: (id: string, body: LlmEndpointUpdate) => api.updateEndpoint(id, body),
    updateRole: (role: LlmRoleId, body: LlmRoleUpdate) => api.updateRole(role, body),
    invalidate,
  }
}

export function useUpdateRole() {
  const qc = useQueryClient()
  const invalidate = useInvalidateLlm()
  return useMutation<LlmConfigResponse, api.ApiError, { role: LlmRoleId; body: LlmRoleUpdate }>({
    mutationFn: ({ role, body }) => api.updateRole(role, body),
    onSuccess: (data) => {
      qc.setQueryData(LLM_CONFIG_KEY, data)
      void invalidate()
    },
  })
}

export function useDeleteEndpoint() {
  const invalidate = useInvalidateLlm()
  return useMutation<{ deleted: boolean; removed_from_roles: LlmRoleId[] }, api.ApiError, { id: string; force: boolean }>({
    mutationFn: ({ id, force }) => api.deleteEndpoint(id, force),
    onSettled: () => void invalidate(),
  })
}

export function useRefreshModels() {
  const invalidate = useInvalidateLlm()
  return useMutation({
    mutationFn: (id: string) => api.refreshModels(id),
    onSettled: () => void invalidate(),
  })
}

export function useTestEndpoint() {
  const invalidate = useInvalidateLlm()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: LlmTestRequest }) => api.testEndpoint(id, body),
    onSettled: () => void invalidate(),
  })
}

/** Enabled toggle: optimistic, rolls back on error. Never carries a token. */
export function useToggleEndpoint() {
  const qc = useQueryClient()
  const invalidate = useInvalidateLlm()
  return useMutation<unknown, api.ApiError, { id: string; enabled: boolean }, { previous?: LlmConfigResponse }>({
    mutationFn: ({ id, enabled }) => api.updateEndpoint(id, { enabled }),
    onMutate: async ({ id, enabled }) => {
      await qc.cancelQueries({ queryKey: LLM_CONFIG_KEY })
      const previous = qc.getQueryData<LlmConfigResponse>(LLM_CONFIG_KEY)
      if (previous) {
        qc.setQueryData<LlmConfigResponse>(LLM_CONFIG_KEY, {
          ...previous,
          endpoints: previous.endpoints.map((e) => (e.id === id ? { ...e, enabled } : e)),
        })
      }
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(LLM_CONFIG_KEY, ctx.previous)
    },
    onSettled: () => void invalidate(),
  })
}
