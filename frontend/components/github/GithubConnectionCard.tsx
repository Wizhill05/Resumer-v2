"use client";

import { AlertTriangle, FolderGit2, Loader2, Lock } from "lucide-react";
import { signInGithub } from "@/app/actions";
import {
  GITHUB_CONNECT_URL,
  GITHUB_PRIVATE_START_URL,
  useDisconnectGithub,
  useGithubIntegration,
  useRemovePrivateAccess,
} from "./useGithubIntegration";
import { GithubNoticeBanner, useGithubReturnNotice } from "./GithubReturnNotice";

export function GithubConnectionCard() {
  const notice = useGithubReturnNotice("/account");
  const { data: integration, isLoading, isError, refetch } =
    useGithubIntegration();
  const disconnect = useDisconnectGithub();
  const removePrivate = useRemovePrivateAccess();

  const mutationError =
    disconnect.error instanceof Error
      ? disconnect.error.message
      : removePrivate.error instanceof Error
        ? removePrivate.error.message
        : null;

  const busy = disconnect.isPending || removePrivate.isPending;
  const needsReauth = integration?.connected && integration.status === "needs_reauth";

  return (
    <section
      className="soft-card p-5"
      aria-labelledby="github-heading"
    >
      <h2
        id="github-heading"
        className="flex items-center gap-2 text-sm font-semibold text-ink-muted"
      >
        <FolderGit2 size={16} aria-hidden="true" className="text-ember" />
        GitHub
      </h2>

      {notice && (
        <div className="mt-3">
          <GithubNoticeBanner notice={notice} />
        </div>
      )}

      {isLoading ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          Checking GitHub connection…
        </p>
      ) : isError ? (
        <div className="mt-3">
          <p className="text-sm font-semibold text-ink">
            Couldn&apos;t load GitHub connection.
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-2 text-sm font-semibold text-ember underline underline-offset-4"
          >
            Try again
          </button>
        </div>
      ) : !integration?.connected ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-ink-muted">
            Import your repos with your own GitHub access instead of the shared
            limit.
          </p>
          <a
            href={GITHUB_CONNECT_URL}
            className="inline-flex h-10 items-center rounded-md bg-[#ff4e26] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#e0441e]"
          >
            Connect GitHub
          </a>
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          <p className="text-sm font-semibold text-ink">
            {integration.kind === "login"
              ? `Signed in with GitHub @${integration.login ?? ""}`
              : `Connected as @${integration.login ?? ""}`}
          </p>

          {needsReauth && (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2"
            >
              <p className="flex items-start gap-2 text-sm font-semibold text-amber-900">
                <AlertTriangle
                  size={15}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0"
                />
                GitHub access expired. Reconnect to keep importing repos.
              </p>
              {integration.kind === "login" ? (
                <form action={signInGithub}>
                  <input type="hidden" name="callbackUrl" value="/account" />
                  <button
                    type="submit"
                    className="inline-flex h-9 cursor-pointer items-center rounded-md bg-[#ff4e26] px-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#e0441e]"
                  >
                    Reconnect GitHub
                  </button>
                </form>
              ) : (
                <a
                  href={GITHUB_CONNECT_URL}
                  className="inline-flex h-9 w-fit items-center rounded-md bg-[#ff4e26] px-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#e0441e]"
                >
                  Reconnect GitHub
                </a>
              )}
            </div>
          )}

          <div className="border-t border-line pt-3">
            {!integration.private_access ? (
              <div className="space-y-2">
                <p className="text-xs leading-relaxed text-ink-muted">
                  GitHub will ask for full repo access. Résumer only reads
                  repository details and never writes. Private README text is
                  sent to our AI to write the project.
                </p>
                <a
                  href={GITHUB_PRIVATE_START_URL}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line-strong bg-paper px-3.5 text-sm font-semibold text-ink transition-colors hover:border-ink/30"
                >
                  <Lock size={14} aria-hidden="true" />
                  Include private repos
                </a>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <Lock size={14} aria-hidden="true" />
                  Private repos enabled
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const isLink = integration.kind === "link";
                    if (
                      window.confirm(
                        isLink
                          ? "This disconnects GitHub, then asks you to connect again without private repos."
                          : "Remove private repo access? Public repos keep syncing.",
                      )
                    ) {
                      removePrivate.mutate(undefined, {
                        onSuccess: (result) => {
                          if (result?.reconnect_required) {
                            window.location.assign(GITHUB_CONNECT_URL);
                          }
                        },
                      });
                    }
                  }}
                  className="inline-flex h-9 cursor-pointer items-center rounded-md border border-line-strong bg-paper px-3.5 text-sm font-semibold text-ink transition-colors hover:border-ink/30 disabled:opacity-50"
                >
                  {removePrivate.isPending ? "Removing…" : "Remove private repo access"}
                </button>
              </div>
            )}
          </div>

          {integration.kind === "link" && (
            <div className="border-t border-line pt-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Disconnect GitHub? You can connect again later.",
                    )
                  ) {
                    disconnect.mutate();
                  }
                }}
                className="inline-flex h-9 cursor-pointer items-center rounded-md border border-red-200 bg-paper px-3.5 text-sm font-semibold text-red-600 transition-colors hover:border-red-400 disabled:opacity-50"
              >
                {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          )}

          {mutationError && (
            <p role="alert" className="text-sm font-semibold text-red-600">
              {mutationError}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
