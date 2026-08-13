"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Plus, Trash2, Edit2, X, FolderGit2, AlertCircle, RefreshCw } from "lucide-react";
import { SaveStatusBadge, SaveStatus } from "./SaveStatusBadge";
import { Textarea } from "@/components/ui/textarea";

const schema = z.object({
  name: z.string().min(1, "Project Name is required"),
  description: z.string().optional(),
  technologies: z.string().optional(), // Raw comma-separated string for editing
  github_url: z.string().url("Invalid URL").or(z.literal("")),
  live_url: z.string().url("Invalid URL").or(z.literal("")),
  start_date: z.string().or(z.literal("")), // ISO date string (YYYY-MM-DD) or empty
  end_date: z.string().or(z.literal("")),
  bullet_points: z.string().optional(), // Raw newlines string for editing
  sort_order: z.number().optional(),
});

type FormData = z.infer<typeof schema>;

type ProjectItem = {
  id: string;
  name: string;
  description?: string;
  technologies?: string[];
  github_url?: string;
  live_url?: string;
  start_date?: string;
  end_date?: string;
  bullet_points?: string[];
  sort_order?: number;
};

type DuplicateCandidate = {
  reason: string;
  confidence: number;
  suggested_action: string;
};

type ImportedProject = ProjectItem & {
  duplicate_candidates?: DuplicateCandidate[];
};

type GitHubRepoItem = {
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  language: string | null;
  stargazers_count: number;
};

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

interface ProjectFormProps {
  onDirtyChange?: (isDirty: boolean, saveFn: () => Promise<boolean>) => void;
}

export function ProjectForm({ onDirtyChange }: ProjectFormProps) {
  const queryClient = useQueryClient();
  const [mounted, setMounted] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  // GitHub import state
  const [githubInputMode, setGithubInputMode] = useState<"fields" | "url">("fields");
  const [githubOwner, setGithubOwner] = useState("");
  const [githubRepoName, setGithubRepoName] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [selectedRepoUrl, setSelectedRepoUrl] = useState("");
  const [githubMessage, setGithubMessage] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportedProject | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch basic user profile to extract github_url automatically
  const { data: profile } = useQuery<{ github_url?: string }>({
    queryKey: ["profile"],
    queryFn: async () => {
      const res = await fetch("/api/backend/profile");
      if (!res.ok) throw new Error("Failed to load profile");
      return res.json();
    },
  });

  const profileGithubUsername = parseGitHubUsername(profile?.github_url);
  const effectiveUsername = githubOwner.trim() || profileGithubUsername;

  // Query GitHub repos whenever a username is present
  const {
    data: githubReposData,
    isLoading: isLoadingRepos,
    isError: isReposError,
    refetch: refetchRepos,
  } = useQuery<{
    repos: GitHubRepoItem[];
    connected: boolean;
    github_username: string | null;
  }>({
    queryKey: ["github-repos", effectiveUsername],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (effectiveUsername) {
        params.set("username", effectiveUsername);
      }
      const res = await fetch(`/api/backend/profile/import/github-repos?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch GitHub repositories");
      return res.json();
    },
    enabled: Boolean(effectiveUsername),
  });

  // Lock scroll and listen for Escape key when modal is open
  useEffect(() => {
    if (!importPreview) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setImportPreview(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [importPreview]);

  const { data: projects = [], isLoading } = useQuery<ProjectItem[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/backend/profile/projects");
      if (!res.ok) throw new Error("Failed to load projects");
      return res.json();
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isDirty, isValid },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const formActive = isAdding || editingId !== null;

  const handleCancel = useCallback(() => {
    reset();
    setEditingId(null);
    setIsAdding(false);
    setImportPreview(null);
  }, [reset]);

  const performSave = useCallback(async (): Promise<boolean> => {
    if (!formActive) return true;
    if (!isDirty) {
      handleCancel();
      return true;
    }
    return new Promise<boolean>((resolve) => {
      handleSubmit(
        async (data) => {
          try {
            await saveMutation.mutateAsync(data);
            resolve(true);
          } catch {
            resolve(false);
          }
        },
        () => {
          resolve(false);
        }
      )();
    });
  }, [formActive, isDirty, handleCancel, handleSubmit, saveMutation]);

  useEffect(() => {
    if (onDirtyChange) {
      onDirtyChange(formActive && isDirty, performSave);
    }
  }, [formActive, isDirty, performSave, onDirtyChange]);
  const saveMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const payload = {
        ...data,
        sort_order: data.sort_order ?? 0,
        start_date: data.start_date || null,
        end_date: data.end_date || null,
        technologies: data.technologies
          ? data.technologies
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
        bullet_points: data.bullet_points
          ? data.bullet_points
              .split("\n")
              .map((b) => b.trim())
              .filter(Boolean)
          : [],
      };

      const url = editingId
        ? `/api/backend/profile/projects/${editingId}`
        : "/api/backend/profile/projects";
      const method = editingId ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to save project");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      reset();
      setEditingId(null);
      setIsAdding(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/backend/profile/projects/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete project");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const githubImportMutation = useMutation({
    mutationFn: async (targetUrl: string) => {
      const res = await fetch("/api/backend/profile/import/github-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl }),
      });
      const body = await res.json();
      if (!res.ok)
        throw new Error(body.detail || "Failed to import GitHub project");
      return body as ImportedProject;
    },
    onSuccess: (project) => {
      setIsAdding(true);
      setEditingId(null);
      setImportPreview(project);
      setValue("name", project.name || "");
      setValue("description", project.description || "");
      setValue(
        "technologies",
        project.technologies ? project.technologies.join(", ") : "",
      );
      setValue("github_url", project.github_url || githubUrl);
      setValue("live_url", project.live_url || "");
      setValue("start_date", "");
      setValue("end_date", "");
      setValue(
        "bullet_points",
        project.bullet_points ? project.bullet_points.join("\n") : "",
      );
      setValue("sort_order", projects.length);
      const duplicate = project.duplicate_candidates?.[0];
      setGithubMessage(
        duplicate
          ? `Possible duplicate: ${duplicate.reason} (${Math.round(duplicate.confidence * 100)}%, ${duplicate.suggested_action})`
          : "GitHub project staged. Review before saving.",
      );
    },
    onError: (err) =>
      setGithubMessage(
        err instanceof Error ? err.message : "Failed to import GitHub project",
      ),
  });

  const handleImportSubmit = () => {
    let target = "";
    if (selectedRepoUrl) {
      target = selectedRepoUrl;
    } else if (githubInputMode === "fields") {
      const owner = githubOwner.trim() || profileGithubUsername;
      if (!owner || !githubRepoName.trim()) {
        setGithubMessage("Please provide a GitHub Username and Repository name.");
        return;
      }
      target = `${owner}/${githubRepoName.trim()}`;
    } else {
      if (!githubUrl.trim()) {
        setGithubMessage("Please enter a GitHub URL or owner/repo.");
        return;
      }
      target = githubUrl.trim();
    }

    setGithubMessage(null);
    githubImportMutation.mutate(target);
  };

  const startEdit = (project: ProjectItem) => {
    setEditingId(project.id);
    setIsAdding(true);
    reset({
      name: project.name,
      description: project.description || "",
      technologies: project.technologies ? project.technologies.join(", ") : "",
      github_url: project.github_url || "",
      live_url: project.live_url || "",
      start_date: project.start_date || "",
      end_date: project.end_date || "",
      bullet_points: project.bullet_points
        ? project.bullet_points.join("\n")
        : "",
      sort_order: project.sort_order || 0,
    });
  };

  // handleCancel defined above via useCallback

  let status: SaveStatus = "saved";
  if (saveMutation.isPending) status = "saving";
  else if (saveMutation.isError) status = "error";
  else if (isDirty) status = "unsaved";

  const renderForm = () => (
    <form
      onSubmit={handleSubmit((data) => saveMutation.mutate(data))}
      onBlur={() => {
        if (isDirty && isValid && !saveMutation.isPending) {
          performSave();
        }
      }}
      className="space-y-4 border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 p-4 pixel-enter"
    >
      <div className="mb-1 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-700 pb-2">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-black dark:text-zinc-100 uppercase tracking-tight">
            {editingId ? "Edit Project" : "Add Project"}
          </h3>
          <SaveStatusBadge status={status} onSaveNow={isDirty ? performSave : undefined} />
        </div>
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleCancel}
          className="border-transparent"
        >
          <X size={16} />
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Project Name</Label>
          <Input id="name" {...register("name")} />
          {errors.name && (
            <p className="text-red-600 dark:text-red-400 text-xs font-bold">
              {errors.name.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="technologies">Technologies (comma separated)</Label>
          <Input
            id="technologies"
            placeholder="React, TS, TailWind"
            {...register("technologies")}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="github_url">GitHub URL</Label>
          <Input id="github_url" {...register("github_url")} />
          {errors.github_url && (
            <p className="text-red-600 dark:text-red-400 text-xs font-bold">
              {errors.github_url.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="live_url">Live URL</Label>
          <Input id="live_url" {...register("live_url")} />
          {errors.live_url && (
            <p className="text-red-600 dark:text-red-400 text-xs font-bold">
              {errors.live_url.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="start_date">Start Date</Label>
          <Input id="start_date" type="date" {...register("start_date")} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="end_date">End Date</Label>
          <Input id="end_date" type="date" {...register("end_date")} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Short Description</Label>
        <Textarea id="description" rows={3} {...register("description")} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="bullet_points">
          Numerical data and impact (one per line)
        </Label>
        <Textarea
          id="bullet_points"
          rows={4}
          placeholder="- Increased conversion by 18% after checkout redesign&#10;- Cut manual review time by 40% with automation"
          {...register("bullet_points")}
        />
      </div>

      <div className="flex gap-3 border-t border-zinc-200 dark:border-zinc-700 pt-3">
        <Button type="submit" disabled={saveMutation.isPending}>
          {saveMutation.isPending ? (
            <>
              <Loader2 className="animate-spin" size={16} /> Saving...
            </>
          ) : (
            "Save"
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleCancel}
          disabled={saveMutation.isPending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <div className="flex gap-2">
          <span className="loading-dot bg-[#ff4e26]" />
          <span className="loading-dot bg-yellow-400" />
          <span className="loading-dot bg-[#ff4e26]" />
        </div>
      </div>
    );
  }

  const userRepos = githubReposData?.repos || [];

  return (
    <div className="space-y-4 pixel-enter">
      {!isAdding && (
        <div className="space-y-4 border border-zinc-950 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 shadow-[4px_4px_0px_#18181b] dark:shadow-[4px_4px_0px_#3f3f46]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <p className="text-xs font-extrabold uppercase tracking-widest text-[#ff4e26]">
                Project import
              </p>
              <h3 className="text-xl font-extrabold uppercase tracking-tight text-black dark:text-zinc-100 flex items-center gap-2">
                <FolderGit2 className="text-[#ff4e26]" size={22} /> Import using GitHub
              </h3>
              <p className="max-w-xl text-sm font-semibold text-zinc-600 dark:text-zinc-400">
                Choose a repository from your GitHub projects dropdown menu below, or enter a username &amp; repository. We extract metadata, README, and stage your project for review.
              </p>
            </div>
            <Button
              onClick={() => {
                setIsAdding(true);
                setEditingId(null);
                setGithubMessage(null);
                setImportPreview(null);
                reset({
                  name: "",
                  description: "",
                  technologies: "",
                  github_url: "",
                  live_url: "",
                  start_date: "",
                  end_date: "",
                  bullet_points: "",
                  sort_order: projects.length,
                });
              }}
              size="sm"
              variant="outline"
            >
              <Plus size={16} /> Add Project Manually
            </Button>
          </div>

          {/* GitHub Linked Username Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 p-3 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            {effectiveUsername ? (
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 fill-current text-zinc-900 dark:text-zinc-100" viewBox="0 0 24 24">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                </svg>
                <span>
                  GitHub Profile Linked: <strong className="text-black dark:text-white">@{effectiveUsername}</strong>
                </span>
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
              </div>
            ) : (
              <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                </svg>
                <span>Enter a GitHub username or repo below to view repositories</span>
              </div>
            )}
          </div>

          {/* Repositories Dropdown (Always visible when a username is present) */}
          {effectiveUsername && (
            <div className="space-y-2 border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 p-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-extrabold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                  Select a repository to import ({isLoadingRepos ? "Loading..." : `${userRepos.length} public repos found`})
                </Label>
                <button
                  type="button"
                  onClick={() => refetchRepos()}
                  disabled={isLoadingRepos}
                  className="flex items-center gap-1 text-[11px] font-bold text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white disabled:opacity-50"
                >
                  <RefreshCw size={11} className={isLoadingRepos ? "animate-spin" : ""} /> Refresh
                </button>
              </div>

              {isLoadingRepos ? (
                <div className="flex items-center justify-center gap-2 py-4 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                  <Loader2 className="animate-spin" size={16} /> Fetching public repositories for @{effectiveUsername}...
                </div>
              ) : isReposError ? (
                <div className="flex items-center justify-between py-2 px-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-xs font-semibold text-red-600 dark:text-red-400">
                  <span>Failed to load repositories. Please try again.</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => refetchRepos()}
                    className="h-7 text-xs font-bold"
                  >
                    Retry
                  </Button>
                </div>
              ) : userRepos.length === 0 ? (
                <div className="py-3 text-center text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                  No public repositories found for @{effectiveUsername}.
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <select
                    value={selectedRepoUrl}
                    onChange={(e) => {
                      setSelectedRepoUrl(e.target.value);
                      if (e.target.value) {
                        setGithubUrl(e.target.value);
                      }
                    }}
                    className="w-full h-11 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-[#ff4e26]"
                  >
                    <option value="">-- Choose a repository from your list --</option>
                    {userRepos.map((repo) => (
                      <option key={repo.full_name} value={repo.html_url}>
                        {repo.full_name} {repo.language ? `(${repo.language})` : ""} {repo.stargazers_count ? `★ ${repo.stargazers_count}` : ""}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    size="lg"
                    onClick={handleImportSubmit}
                    disabled={githubImportMutation.isPending || !selectedRepoUrl}
                  >
                    {githubImportMutation.isPending ? (
                      <>
                        <Loader2 className="animate-spin" size={18} /> Reading...
                      </>
                    ) : (
                      <>
                        <FolderGit2 size={18} /> Import Selected Project
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Manual Input Controls Mode Selector */}
          <div className="space-y-3 pt-1">
            <div className="flex gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-2">
              <button
                type="button"
                onClick={() => {
                  setGithubInputMode("fields");
                  setSelectedRepoUrl("");
                }}
                className={`text-xs font-extrabold uppercase tracking-wide transition-colors ${
                  githubInputMode === "fields" && !selectedRepoUrl
                    ? "text-[#ff4e26] border-b-2 border-[#ff4e26] pb-1"
                    : "text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white"
                }`}
              >
                Username &amp; Repo Name
              </button>
              <button
                type="button"
                onClick={() => {
                  setGithubInputMode("url");
                  setSelectedRepoUrl("");
                }}
                className={`text-xs font-extrabold uppercase tracking-wide transition-colors ${
                  githubInputMode === "url" && !selectedRepoUrl
                    ? "text-[#ff4e26] border-b-2 border-[#ff4e26] pb-1"
                    : "text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white"
                }`}
              >
                Full Link / Shorthand
              </button>
            </div>

            {githubInputMode === "fields" && !selectedRepoUrl ? (
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-[1fr_1fr_auto]">
                <div>
                  <Label htmlFor="githubOwner" className="text-xs font-bold text-zinc-600 dark:text-zinc-400">
                    GitHub Username
                  </Label>
                  <Input
                    id="githubOwner"
                    value={githubOwner}
                    onChange={(e) => setGithubOwner(e.target.value)}
                    placeholder={profileGithubUsername || "e.g. facebook"}
                    className="h-11 text-sm font-semibold mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="githubRepoName" className="text-xs font-bold text-zinc-600 dark:text-zinc-400">
                    Repository Name
                  </Label>
                  <Input
                    id="githubRepoName"
                    value={githubRepoName}
                    onChange={(e) => setGithubRepoName(e.target.value)}
                    placeholder="e.g. react"
                    className="h-11 text-sm font-semibold mt-1"
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    size="lg"
                    onClick={handleImportSubmit}
                    disabled={githubImportMutation.isPending || (!githubOwner.trim() && !profileGithubUsername) || !githubRepoName.trim()}
                    className="h-11 w-full sm:w-auto"
                  >
                    {githubImportMutation.isPending ? (
                      <>
                        <Loader2 className="animate-spin" size={18} /> Reading...
                      </>
                    ) : (
                      <>
                        <FolderGit2 size={18} /> Import
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ) : !selectedRepoUrl ? (
              <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                <Input
                  value={githubUrl}
                  onChange={(event) => setGithubUrl(event.target.value)}
                  placeholder="https://github.com/owner/repo or owner/repo"
                  className="h-11 text-base font-semibold"
                />
                <Button
                  type="button"
                  size="lg"
                  onClick={handleImportSubmit}
                  disabled={githubImportMutation.isPending || !githubUrl.trim()}
                >
                  {githubImportMutation.isPending ? (
                    <>
                      <Loader2 className="animate-spin" size={18} /> Reading...
                    </>
                  ) : (
                    <>
                      <FolderGit2 size={18} /> Import Using GitHub
                    </>
                  )}
                </Button>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2 text-[11px] font-extrabold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            <span>{projects.length} saved projects</span>
            <span>README aware</span>
            <span>Duplicate checks</span>
            <span>Review before save</span>
          </div>

          {githubMessage && (
            <p className="border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-2.5 text-xs font-bold text-zinc-800 dark:text-zinc-200">
              {githubMessage}
            </p>
          )}
        </div>
      )}

      {/* REACT PORTAL FOR IMPORT PREVIEW MODAL - BREAKS OUT OF CONTAINER STACKING CONTEXT */}
      {mounted &&
        importPreview &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/75 p-4 backdrop-blur-xs pixel-enter"
            onClick={(e) => {
              if (e.target === e.currentTarget) setImportPreview(null);
            }}
          >
            <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto border border-zinc-950 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 shadow-[6px_6px_0px_#18181b] dark:shadow-[6px_6px_0px_#3f3f46] text-black dark:text-white md:p-5">
              <div className="mb-4 flex items-start justify-between gap-3 border-b border-zinc-200 dark:border-zinc-700 pb-3">
                <div>
                  <p className="text-xs font-extrabold uppercase tracking-widest text-[#ff4e26]">
                    GitHub import staged
                  </p>
                  <h3 className="text-lg font-extrabold uppercase tracking-tight text-black dark:text-zinc-100">
                    {importPreview.name || "Untitled project"}
                  </h3>
                  <p className="mt-1 text-sm font-semibold text-zinc-600 dark:text-zinc-400">
                    Review these extracted details, then save the form below to add it.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setImportPreview(null)}
                  className="border-transparent"
                >
                  <X size={16} />
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-3">
                  <p className="text-xs font-extrabold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Description added
                  </p>
                  <p className="mt-1 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                    {importPreview.description || "No description found."}
                  </p>
                </div>
                <div className="border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-3">
                  <p className="text-xs font-extrabold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Tech added
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(importPreview.technologies?.length
                      ? importPreview.technologies
                      : ["No technologies found"]
                    ).map((tech) => (
                      <span
                        key={tech}
                        className="border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 px-2 py-0.5 text-[10px] font-extrabold uppercase text-zinc-700 dark:text-zinc-200"
                      >
                        {tech}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-3 md:col-span-2">
                  <p className="text-xs font-extrabold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Impact bullets added
                  </p>
                  {importPreview.bullet_points?.length ? (
                    <ul className="mt-2 list-inside list-disc space-y-1 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                      {importPreview.bullet_points.map((bullet, index) => (
                        <li key={index}>{bullet}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm font-semibold text-zinc-600 dark:text-zinc-400">
                      No bullets found.
                    </p>
                  )}
                </div>
                {importPreview.duplicate_candidates?.[0] && (
                  <div className="border border-yellow-300 dark:border-yellow-700/60 bg-yellow-50 dark:bg-yellow-950/40 p-3 md:col-span-2">
                    <p className="text-xs font-extrabold uppercase tracking-wide text-yellow-900 dark:text-yellow-300">
                      Possible duplicate
                    </p>
                    <p className="mt-1 text-sm font-bold text-yellow-950 dark:text-yellow-200">
                      {importPreview.duplicate_candidates[0].reason} (
                      {Math.round(
                        importPreview.duplicate_candidates[0].confidence * 100,
                      )}
                      % confidence,{" "}
                      {importPreview.duplicate_candidates[0].suggested_action})
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-200 dark:border-zinc-700 pt-3">
                <Button type="button" onClick={() => setImportPreview(null)}>
                  Review Form
                </Button>
                <Button type="button" variant="outline" onClick={handleCancel}>
                  Discard Import
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {isAdding && !editingId && renderForm()}

      <div className="space-y-3">
        {projects.map((proj) => (
          <div key={proj.id} className="space-y-3">
            <div className="flex items-start justify-between gap-3 border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 transition-colors hover:border-zinc-400 dark:hover:border-zinc-500 md:p-4">
              <div className="min-w-0 space-y-1.5">
                <h4 className="text-base font-extrabold uppercase tracking-tight text-black dark:text-zinc-100">
                  {proj.name}
                </h4>
                {proj.technologies && proj.technologies.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {proj.technologies.map((t: string) => (
                      <span
                        key={t}
                        className="border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 py-0.5 text-[10px] font-bold uppercase text-zinc-600 dark:text-zinc-300"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mt-2">
                  {proj.description}
                </p>
                {proj.bullet_points && proj.bullet_points.length > 0 && (
                  <ul className="mt-2 list-inside list-disc space-y-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    {proj.bullet_points.map((b: string, i: number) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-4 mt-3 text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                  {proj.github_url && (
                    <a
                      href={proj.github_url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-[#ff4e26]"
                    >
                      GitHub
                    </a>
                  )}
                  {proj.live_url && (
                    <a
                      href={proj.live_url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-[#ff4e26]"
                    >
                      Live Site
                    </a>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => startEdit(proj)}
                  className="border-transparent hover:border-black dark:hover:border-zinc-400"
                >
                  <Edit2 size={14} className="text-black dark:text-zinc-200" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => {
                    if (confirm("Are you sure?"))
                      deleteMutation.mutate(proj.id);
                  }}
                  className="border-transparent hover:border-red-500 hover:text-red-500"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
            {editingId === proj.id && renderForm()}
          </div>
        ))}
      </div>
    </div>
  );
}
