"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

const REASON_MESSAGES: Record<string, string> = {
  already_linked:
    "This GitHub account is already connected to another Résumer account.",
  different_account:
    "You authorized a different GitHub account than the one you sign in with.",
  denied: "GitHub access was cancelled.",
  expired: "That link expired. Try again.",
  failed: "Couldn't connect GitHub. Try again.",
  sign_in_again: "Sign out and sign in with GitHub once more, then try again.",
};

export type GithubNotice = { type: "success" | "error"; message: string } | null;

function noticeFromParams(params: URLSearchParams): GithubNotice {
  const github = params.get("github");
  if (github === "connected") {
    return { type: "success", message: "GitHub connected." };
  }
  if (github === "error") {
    const reason = params.get("reason") ?? "";
    return {
      type: "error",
      message: REASON_MESSAGES[reason] ?? "Couldn't connect GitHub. Try again.",
    };
  }
  return null;
}

/**
 * Reads the `?github=connected|error&reason=` result the GitHub start/callback
 * routes append to `returnTo`, refreshes the GitHub queries so new access shows
 * up immediately, and strips those params from the URL (other params stay).
 */
export function useGithubReturnNotice(fallbackPath: string): GithubNotice {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [notice] = useState<GithubNotice>(() => noticeFromParams(searchParams));

  useEffect(() => {
    if (!searchParams.get("github")) return;
    queryClient.invalidateQueries({ queryKey: ["github-integration"] });
    queryClient.invalidateQueries({ queryKey: ["github-repos"] });
    const params = new URLSearchParams(searchParams.toString());
    params.delete("github");
    params.delete("reason");
    const qs = params.toString();
    const base = pathname ?? fallbackPath;
    router.replace(qs ? `${base}?${qs}` : base, { scroll: false });
  }, [searchParams, router, pathname, queryClient, fallbackPath]);

  return notice;
}

export function GithubNoticeBanner({ notice }: { notice: GithubNotice }) {
  if (!notice) return null;
  return (
    <p
      role={notice.type === "error" ? "alert" : "status"}
      className={
        notice.type === "error"
          ? "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
          : "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700"
      }
    >
      {notice.message}
    </p>
  );
}
