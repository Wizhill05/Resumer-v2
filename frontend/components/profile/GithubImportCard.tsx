"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clipboard, FolderGit2, Link2, Loader2, Lock, Plus, RefreshCw, Search, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GithubMark } from "@/components/icons/GithubMark";
import {
  GITHUB_PROFILE_CONNECT_URL,
  isGithubConnectedActive,
  useGithubIntegration,
} from "@/components/github/useGithubIntegration";

type GitHubRepoItem = {
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  updated_at?: string;
  private: boolean;
};

type GitHubReposData = {
  repos: GitHubRepoItem[];
  connected: boolean;
  github_username: string | null;
  source: "token" | "public";
};

export type GithubApiError = Error & {
  status?: number;
  detail?: string;
  reset_at?: string;
};

export function formatGithubError(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    const apiErr = err as GithubApiError;
    if (apiErr.status === 429) {
      const when = apiErr.reset_at
        ? new Date(apiErr.reset_at).toLocaleString()
        : "later";
      return `GitHub's shared limit is used up until ${when}. Connect GitHub to keep importing.`;
    }
    if (apiErr.status === 409) {
      return "Reconnect GitHub to keep importing.";
    }
    return err.message || fallback;
  }
  return fallback;
}

export function parseGitHubUsername(input: string | undefined | null): string {
  if (!input) return "";
  let clean = input.trim();
  clean = clean.replace(/^@/, "");
  if (clean.includes("github.com/")) {
    const parts = clean.split("github.com/")[1].split("/").filter(Boolean);
    return parts[0] || "";
  }
  return clean.split("/")[0] || "";
}

const NAME = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})";
const REPO = "[A-Za-z0-9._-]+";
const SHORTHAND_RE = new RegExp(`^${NAME}/${REPO}/?$`);
const USERNAME_RE = new RegExp(`^@?${NAME}$`);

/** Returns `owner/repo` when the query is a GitHub link or shorthand. */
function parseRepoTarget(query: string): string | null {
  const q = query.trim().replace(/\.git$/, "");
  if (!q) return null;
  if (/github\.com\//i.test(q)) {
    const [owner, repo] = q.split(/github\.com\//i)[1].split(/[/?#]/).filter(Boolean);
    return owner && repo ? `${owner}/${repo}` : null;
  }
  return SHORTHAND_RE.test(q) ? q.replace(/\/$/, "") : null;
}

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572a5",
  Rust: "#dea584",
  Go: "#00add8",
  Java: "#b07219",
  Kotlin: "#a97bff",
  Swift: "#f05138",
  "C++": "#f34b7d",
  C: "#555555",
  "C#": "#178600",
  Ruby: "#701516",
  PHP: "#4f5d95",
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Dart: "#00b4ab",
  "Jupyter Notebook": "#da5b0b",
  Vue: "#41b883",
  Svelte: "#ff3e00",
};

function timeAgo(iso?: string): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const s = Math.max(0, (Date.now() - then) / 1000);
  const units: [number, string][] = [
    [31536000, "y"],
    [2592000, "mo"],
    [604800, "w"],
    [86400, "d"],
    [3600, "h"],
    [60, "m"],
  ];
  for (const [secs, label] of units) {
    if (s >= secs) return `${Math.floor(s / secs)}${label} ago`;
  }
  return "just now";
}

interface GithubImportCardProps {
  /** Owner/repo or URL currently being imported, if any. */
  importingTarget: string | null;
  onImport: (target: string) => void;
  onAddManually: () => void;
  message: string | null;
  /** Rendered under the status message, e.g. a "Report import issue" button. */
  messageAction?: React.ReactNode;
}

export function GithubImportCard({
  importingTarget,
  onImport,
  onAddManually,
  message,
  messageAction,
}: GithubImportCardProps) {
  const [query, setQuery] = useState("");
  const [browseOwner, setBrowseOwner] = useState("");

  const { data: profile } = useQuery<{ github_url?: string }>({
    queryKey: ["profile"],
    queryFn: async () => {
      const res = await fetch("/api/backend/profile");
      if (!res.ok) throw new Error("Failed to load profile");
      return res.json();
    },
  });
  const profileUsername = parseGitHubUsername(profile?.github_url);

  const { data: integration, isLoading: isIntegrationLoading } = useGithubIntegration();
  const isConnected = isGithubConnectedActive(integration);
  const login = integration?.login ?? null;
  const username = browseOwner || profileUsername;
  const usingToken = isConnected && !browseOwner;

  const {
    data: reposData,
    isLoading: isReposLoading,
    isFetching: isReposFetching,
    isError: isReposError,
    error: reposError,
    refetch,
  } = useQuery<GitHubReposData>({
    queryKey: usingToken ? ["github-repos", "token"] : ["github-repos", username],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (!usingToken && username) params.set("username", username);
      const res = await fetch(`/api/backend/profile/import/github-repos?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const err = new Error(body.detail || "Failed to fetch GitHub repositories") as GithubApiError;
        err.status = res.status;
        err.detail = body.detail;
        err.reset_at = body.reset_at;
        throw err;
      }
      return res.json();
    },
    enabled: !isIntegrationLoading && (usingToken || Boolean(username)),
  });

  const repos = useMemo(() => reposData?.repos ?? [], [reposData]);
  const ownerLabel = usingToken ? login : username;
  const linkTarget = parseRepoTarget(query);
  const trimmed = query.trim();
  const browseCandidate =
    !linkTarget && USERNAME_RE.test(trimmed) && (trimmed.startsWith("@") || (!usingToken && !username))
      ? trimmed.replace(/^@/, "")
      : null;

  const filtered = useMemo(() => {
    if (linkTarget || !trimmed || trimmed.startsWith("@")) return repos;
    const q = trimmed.toLowerCase();
    return repos.filter(
      (r) => r.full_name.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q),
    );
  }, [repos, trimmed, linkTarget]);

  const isBusy = Boolean(importingTarget);
  const loading = isIntegrationLoading || isReposLoading;
  const errorStatus = (reposError as GithubApiError | null)?.status;
  const hasSource = usingToken || Boolean(username);

  const submitQuery = () => {
    if (isBusy) return;
    if (linkTarget) onImport(linkTarget);
    else if (browseCandidate) {
      setBrowseOwner(browseCandidate);
      setQuery("");
    } else if (filtered.length === 1) onImport(filtered[0].html_url);
  };

  const countLabel = loading
    ? "Loading…"
    : usingToken
      ? `${repos.length} repos${repos.some((r) => r.private) ? ` · ${repos.filter((r) => r.private).length} private` : ""}`
      : `${repos.length} public`;

  return (
    <div className="soft-card space-y-4 p-4 md:p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex min-w-0 items-center gap-2.5 text-base font-semibold tracking-tight text-ink md:text-lg">
          <FolderGit2 size={20} className="shrink-0 text-ember" aria-hidden="true" />
          <span className="truncate">Import from GitHub</span>
        </h3>
        <Button
          type="button"
          variant="outline"
          onClick={onAddManually}
          aria-label="Add project manually"
          className="h-10 w-10 shrink-0 px-0 sm:w-auto sm:px-3"
        >
          <Plus size={18} aria-hidden="true" />
          <span className="hidden sm:inline">Add manually</span>
        </Button>
      </div>

      <p className="text-sm leading-relaxed text-ink-muted">
        Pick a repo or paste a link. You&rsquo;ll review it before it&rsquo;s saved.
      </p>

      <div className="space-y-2">
        <div className="relative">
          <Search
            size={18}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint"
            aria-hidden="true"
          />
          <input
            type="text"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitQuery();
              }
            }}
            placeholder={hasSource ? "Search repos or paste a GitHub link" : "Paste a GitHub link or type a username"}
            aria-label="Search repositories or paste a GitHub link"
            className="h-12 w-full rounded-md border border-line-strong bg-paper pl-10 pr-3 text-base text-ink outline-none transition-[border-color] placeholder:text-ink-faint hover:border-ink/30 focus:border-ember md:text-sm"
          />
        </div>

        <div className="overflow-hidden rounded-md border border-line bg-ink/[0.025]">
          {hasSource && (
            <div className="flex items-center justify-between gap-2 border-b border-line py-2 pl-4 pr-2">
              <p className="min-w-0 truncate text-[13px] text-ink-muted">
                <span className="font-medium text-ink-soft dark:text-ink-muted">@{ownerLabel}</span>
                {" · "}
                {countLabel}
                {browseOwner && (
                  <button
                    type="button"
                    onClick={() => setBrowseOwner("")}
                    className="ml-2 cursor-pointer text-ember underline-offset-4 hover:underline"
                  >
                    Back to {isConnected ? "yours" : `@${profileUsername || "you"}`}
                  </button>
                )}
              </p>
              <button
                type="button"
                onClick={() => refetch()}
                disabled={isReposFetching}
                aria-label="Refresh repositories"
                title="Refresh repositories"
                className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded text-ink-muted transition-colors hover:bg-ink/[0.06] hover:text-ink disabled:cursor-default disabled:opacity-60"
              >
                <RefreshCw size={15} className={isReposFetching ? "animate-spin" : ""} aria-hidden="true" />
              </button>
            </div>
          )}

          {linkTarget && (
            <RepoRow
              onClick={() => onImport(linkTarget)}
              disabled={isBusy}
              busy={importingTarget === linkTarget}
              icon={<Link2 size={16} className="text-ink-faint" aria-hidden="true" />}
              title={linkTarget}
              meta="Import from link"
            />
          )}

          {browseCandidate && (
            <RepoRow
              onClick={() => {
                setBrowseOwner(browseCandidate);
                setQuery("");
              }}
              disabled={isBusy}
              icon={<UserRound size={16} className="text-ink-faint" aria-hidden="true" />}
              title={`@${browseCandidate}`}
              meta="Browse their public repos"
              action="Browse"
            />
          )}

          {!hasSource ? null : loading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-ink-muted">
              <Loader2 className="animate-spin" size={16} aria-hidden="true" />
              Fetching repositories…
            </div>
          ) : isReposError ? (
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm text-red-600 dark:text-red-400">
              <span>
                {errorStatus === 409
                  ? "Reconnect GitHub to keep importing."
                  : errorStatus === 429
                    ? formatGithubError(reposError, "Failed to load repositories.")
                    : "Couldn't load repositories."}
              </span>
              {errorStatus === 409 ? (
                <a href="/account" className="font-semibold text-ember underline-offset-4 hover:underline">
                  Reconnect
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="cursor-pointer font-semibold text-ember underline-offset-4 hover:underline"
                >
                  Retry
                </button>
              )}
            </div>
          ) : repos.length === 0 ? (
            <p className="px-4 py-5 text-center text-sm text-ink-muted">
              {usingToken ? "No repositories found." : `No public repositories for @${username}.`}
            </p>
          ) : filtered.length === 0 && !linkTarget ? (
            <p className="px-4 py-5 text-center text-sm text-ink-muted">
              No repos match &ldquo;{trimmed}&rdquo;.
            </p>
          ) : (
            <ul className="max-h-[17.5rem] divide-y divide-line overflow-y-auto overscroll-contain">
              {filtered.map((repo) => {
                const showFull = ownerLabel
                  ? !repo.full_name.toLowerCase().startsWith(`${ownerLabel.toLowerCase()}/`)
                  : false;
                const updated = timeAgo(repo.updated_at);
                return (
                  <li key={repo.full_name}>
                    <RepoRow
                      onClick={() => onImport(repo.html_url)}
                      disabled={isBusy}
                      busy={importingTarget === repo.html_url}
                      title={showFull ? repo.full_name : repo.name}
                      locked={repo.private}
                      meta={
                        <>
                          {repo.language && (
                            <>
                              <span
                                className="inline-block h-2 w-2 shrink-0 rounded-full"
                                style={{ background: LANGUAGE_COLORS[repo.language] ?? "var(--ink-faint)" }}
                                aria-hidden="true"
                              />
                              <span>{repo.language}</span>
                            </>
                          )}
                          {repo.language && updated && <span aria-hidden="true">·</span>}
                          {updated && <span>Updated {updated}</span>}
                        </>
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}

          {!linkTarget && (
            <p className={`flex items-center gap-2.5 px-4 py-3 text-[13px] text-ink-faint ${hasSource || browseCandidate ? "border-t border-line" : ""}`}>
              <Clipboard size={15} className="shrink-0" aria-hidden="true" />
              <span>
                Or paste a link, e.g. <span className="whitespace-nowrap">github.com/vercel/next.js</span>
              </span>
            </p>
          )}
        </div>
      </div>

      {integration && !integration.connected && (
        <div className="flex items-center justify-between gap-3 text-[13px] text-ink-muted">
          <span className="flex min-w-0 items-center gap-2">
            <GithubMark size={15} className="shrink-0" />
            <span>Connect GitHub to see private repos</span>
          </span>
          <a
            href={GITHUB_PROFILE_CONNECT_URL}
            className="shrink-0 font-semibold text-ember underline-offset-4 hover:underline"
          >
            Connect
          </a>
        </div>
      )}

      {message && (
        <div className="space-y-2">
          <p role="status" className="rounded-md border border-line bg-ink/[0.03] px-3 py-2.5 text-sm text-ink">
            {message}
          </p>
          {messageAction}
        </div>
      )}
    </div>
  );
}

function RepoRow({
  onClick,
  disabled,
  busy,
  icon,
  title,
  meta,
  locked,
  action = "Import",
}: {
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  icon?: React.ReactNode;
  title: string;
  meta?: React.ReactNode;
  locked?: boolean;
  action?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-ink/[0.04] focus-visible:bg-ink/[0.04] focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent"
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[15px] font-semibold text-ink">{title}</span>
          {locked && (
            <Lock size={12} className="shrink-0 text-ink-muted" aria-label="Private repository" />
          )}
        </span>
        {meta && (
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[13px] text-ink-muted">
            {meta}
          </span>
        )}
      </span>
      <span
        className={`flex shrink-0 items-center gap-1.5 text-sm font-semibold ${disabled && !busy ? "text-ink-faint" : "text-ember"}`}
      >
        {busy ? (
          <>
            <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Reading…
          </>
        ) : (
          action
        )}
      </span>
    </button>
  );
}
