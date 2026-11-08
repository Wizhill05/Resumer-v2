"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type GithubIntegration = {
  connected: boolean;
  login: string | null;
  kind: "login" | "link" | null;
  private_access: boolean;
  status: "active" | "needs_reauth" | null;
  can_disconnect: boolean;
};

export const GITHUB_CONNECT_URL =
  "/api/integrations/github/start?private=0&returnTo=/account";
export const GITHUB_PRIVATE_START_URL =
  "/api/integrations/github/start?private=1&returnTo=/account";
export const GITHUB_PROFILE_CONNECT_URL =
  "/api/integrations/github/start?private=0&returnTo=/profile";

export function isGithubConnectedActive(
  integration: GithubIntegration | undefined,
): boolean {
  return Boolean(integration?.connected) && integration?.status !== "needs_reauth";
}

export function useGithubIntegration() {
  return useQuery<GithubIntegration>({
    queryKey: ["github-integration"],
    queryFn: async () => {
      const res = await fetch("/api/backend/integrations/github");
      if (!res.ok) throw new Error("Failed to load GitHub connection");
      return res.json();
    },
  });
}

function useInvalidateGithub() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["github-integration"] });
    queryClient.invalidateQueries({ queryKey: ["github-repos"] });
  };
}

export function useDisconnectGithub() {
  const invalidate = useInvalidateGithub();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/backend/integrations/github", {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to disconnect GitHub");
      return res.json();
    },
    onSuccess: invalidate,
  });
}

export function useRemovePrivateAccess() {
  const invalidate = useInvalidateGithub();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/backend/integrations/github/private", {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to remove private repo access");
      return res.json();
    },
    onSuccess: invalidate,
  });
}
