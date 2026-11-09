"use client";

import { useProfileWork } from "./ProfileChanges"
import { ProfileDialog } from "./ProfileDialog"
import { QueryError } from "./QueryError"
import { useEffect, useState, useCallback } from "react";
import { useProfileDraft } from "./useProfileDraft"
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2, Edit2, X } from "lucide-react";
import { SaveStatusBadge, SaveStatus } from "./SaveStatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ReportIssueButton } from "@/components/support/ReportIssueButton";
import { GithubImportCard, formatGithubError, type GithubApiError } from "./GithubImportCard";

import { normalizeUrl } from "./BasicInfoForm";

const schema = z.object({
  name: z.string().min(1, "Project Name is required"),
  description: z.string().optional(),
  technologies: z.string().optional(), // Raw comma-separated string for editing
  github_url: z.string().optional(),
  live_url: z.string().optional(),
  start_date: z.string().or(z.literal("")), // ISO date string (YYYY-MM-DD) or empty
  end_date: z.string().or(z.literal("")),
  bullet_points: z.string().optional(), // Raw newlines string for editing
  sort_order: z.number().optional(),
});

const draftSchema = schema.extend({ name: z.string() })

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
  warnings?: { scope: string; message: string }[];
};

interface ProjectFormProps {
  onDirtyChange?: (isDirty: boolean, saveFn: () => Promise<boolean>, busy?: boolean, discardDraft?: () => void) => void;
}

export function ProjectForm({ onDirtyChange }: ProjectFormProps) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const activeRecordId = editingId;
  const [githubMessage, setGithubMessage] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportedProject | null>(null);

  const { data: projects = [], isLoading, isError, refetch } = useQuery<ProjectItem[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/backend/profile/projects");
      if (!res.ok) throw new Error("Failed to load projects");
      return res.json();
    },
  });

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
  });
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isDirty },
  } = form


  const formActive = isAdding || editingId !== null;

  const { clear: clearDraft, notice: draftNotice } = useProfileDraft({ kind: "project", recordId: editingId, active: formActive, form, schema: draftSchema })

  const handleCancel = useCallback(() => {
    clearDraft()
    reset();
    setEditingId(null);
    setIsAdding(false);
    setImportPreview(null);
  }, [reset, clearDraft]);

  const saveMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const payload = {
        ...data,
        github_url: normalizeUrl(data.github_url),
        live_url: normalizeUrl(data.live_url),
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
      const url = activeRecordId
        ? `/api/backend/profile/projects/${activeRecordId}`
        : "/api/backend/profile/projects";
      const method = activeRecordId ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to save project");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] })
      handleCancel()
    },
  })

  const handleDirectSaveImport = useCallback(async () => {
    if (!importPreview) return;
    const formData: FormData = {
      name: importPreview.name || "Untitled Project",
      description: importPreview.description || "",
      technologies: importPreview.technologies ? importPreview.technologies.join(", ") : "",
      github_url: importPreview.github_url || "",
      live_url: importPreview.live_url || "",
      start_date: importPreview.start_date || "",
      end_date: importPreview.end_date || "",
      bullet_points: importPreview.bullet_points ? importPreview.bullet_points.join("\n") : "",
    };
    try {
      await saveMutation.mutateAsync(formData);
    } catch {}
  }, [importPreview, saveMutation]);

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
      onDirtyChange(formActive && isDirty, performSave, saveMutation.isPending, clearDraft);
    }
  }, [formActive, isDirty, performSave, onDirtyChange, saveMutation.isPending, clearDraft]);

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
      if (!res.ok) {
        const err = new Error(
          body.detail || "Failed to import GitHub project",
        ) as GithubApiError;
        err.status = res.status;
        err.detail = body.detail;
        err.reset_at = body.reset_at;
        throw err;
      }
      return body as ImportedProject;
    },
    onSuccess: (project, target) => {
      setIsAdding(true);
      setEditingId(null);
      setImportPreview(project);
      setValue("name", project.name || "", { shouldDirty: true });
      setValue("description", project.description || "", { shouldDirty: true });
      setValue(
        "technologies",
        project.technologies ? project.technologies.join(", ") : "",
        { shouldDirty: true },
      );
      setValue("github_url", project.github_url || (target.includes("github.com") ? target : `https://github.com/${target}`), { shouldDirty: true });
      setValue("live_url", project.live_url || "", { shouldDirty: true });
      setValue("start_date", "", { shouldDirty: true });
      setValue("end_date", "", { shouldDirty: true });
      setValue(
        "bullet_points",
        project.bullet_points ? project.bullet_points.join("\n") : "",
        { shouldDirty: true },
      );
      setValue("sort_order", projects.length, { shouldDirty: true });
      const duplicate = project.duplicate_candidates?.[0];
      setGithubMessage(
        duplicate
          ? `Possible duplicate: ${duplicate.reason} (${Math.round(duplicate.confidence * 100)}%, ${duplicate.suggested_action})`
          : "GitHub project staged. Review before saving.",
      );
    },
    onError: (err) =>
      setGithubMessage(formatGithubError(err, "Failed to import GitHub project")),
  });

  useProfileWork("github-import", false, githubImportMutation.isPending)

  const handleImport = (target: string) => {
    setGithubMessage(null);
    githubImportMutation.mutate(target);
  };

  const startAdd = () => {
    saveMutation.reset();
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
  };

  const startEdit = (project: ProjectItem) => {
    saveMutation.reset()
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

  const requestClose = () => {
    if (saveMutation.isPending) return
    if (!isDirty || window.confirm("Discard your unsaved changes?")) handleCancel()
  }

  const renderForm = () => (
    <ProfileDialog label={activeRecordId ? "Edit project" : "Add project"} busy={saveMutation.isPending} onRequestClose={requestClose}>
      <form
        onSubmit={handleSubmit((data) => {
              saveMutation.mutate(data);
        })}
        className="profile-entry-form space-y-4"
      >
        <div className="mb-1 flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-bold tracking-tight text-ink md:text-xl">
              {activeRecordId ? "Edit project" : "Add project"}
            </h3>
            <SaveStatusBadge status={!activeRecordId && !isDirty && !saveMutation.isError ? "draft" : status} onSaveNow={isDirty ? () => performSave() : undefined} />
          </div>
          <Button
            type="button"
            variant="ghost"
            aria-label="Close editor"
            size="sm"
            onClick={requestClose}
            className="h-9 w-9 p-0 border-transparent text-ink-muted hover:text-ink dark:hover:text-white"
          >
            <X size={18} />
          </Button>
        </div>

        {draftNotice}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Project Name</Label>
            <Input id="name" aria-invalid={!!errors.name} aria-describedby={errors.name ? "name-error" : undefined} {...register("name")} />
            {errors.name && (
              <p id="name-error" role="alert" className="text-red-600 dark:text-red-400 text-xs font-bold">
                {errors.name.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="technologies">Technologies (comma separated)</Label>
            <Input
              id="technologies"
              placeholder="React, TS, TailWind"
              {...register("technologies")}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="github_url">GitHub URL</Label>
            <Input id="github_url" aria-invalid={!!errors.github_url} aria-describedby={errors.github_url ? "github_url-error" : undefined} {...register("github_url")} />
            {errors.github_url && (
              <p id="github_url-error" role="alert" className="text-red-600 dark:text-red-400 text-xs font-bold">
                {errors.github_url.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="live_url">Live URL</Label>
            <Input id="live_url" aria-invalid={!!errors.live_url} aria-describedby={errors.live_url ? "live_url-error" : undefined} {...register("live_url")} />
            {errors.live_url && (
              <p id="live_url-error" role="alert" className="text-red-600 dark:text-red-400 text-xs font-bold">
                {errors.live_url.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="start_date">Start Date</Label>
            <Input id="start_date" type="date" {...register("start_date")} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="end_date">End Date</Label>
            <Input id="end_date" type="date" {...register("end_date")} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">Short Description</Label>
          <Textarea id="description" rows={3} {...register("description")} />
        </div>

        <div className="space-y-1.5">
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

        <div className="flex gap-3 border-t border-line pt-3">
          <Button type="submit" disabled={saveMutation.isPending} className="flex-1 md:flex-none">
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
            onClick={requestClose}
            disabled={saveMutation.isPending}
            className="flex-1 md:flex-none"
          >
            Cancel
          </Button>
        </div>
      </form>
    </ProfileDialog>
  );

  if (isError) return <QueryError message="Could not load projects. Your entries have not been removed." onRetry={() => { void refetch() }} />

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <div className="flex gap-2">
          <span className="loading-dot bg-[#ff4e26]" />
          <span className="loading-dot bg-[#ffb199]" />
          <span className="loading-dot bg-[#ff4e26]" />
        </div>
      </div>
    );
  }

  const importingTarget = githubImportMutation.isPending ? githubImportMutation.variables ?? null : null;
  const githubFailed = Boolean(
    githubMessage && /failed|could not|couldn't|error|limit|reconnect/i.test(githubMessage),
  );

  return (
    <div className="space-y-3 pixel-enter md:space-y-4">
      {deleteMutation.isPending && <p role="status" className="text-sm">Deleting entry...</p>}
      {deleteMutation.isError && <QueryError message="Could not delete the entry. Please try deleting it again." onRetry={() => { if (deleteMutation.variables) deleteMutation.mutate(deleteMutation.variables) }} />}

      <h2 className="flex items-center gap-2.5 pb-1 text-xl font-bold tracking-tight text-ink md:text-2xl">
        Projects
        <span className="rounded bg-ink/5 px-1.5 py-0.5 text-xs font-semibold text-ink-soft">{projects.length}</span>
      </h2>

      <GithubImportCard
        importingTarget={importingTarget}
        onImport={handleImport}
        onAddManually={startAdd}
        message={githubMessage}
        messageAction={
          githubFailed ? (
            <ReportIssueButton
              defaultCategory="import"
              defaultMessage={`[GitHub import failed]\nMessage: ${githubMessage}\nInput: ${githubImportMutation.variables ?? "-"}\n\nDescribe what repo you tried to import and expected outcome:\n`}
              title="Report GitHub import issue"
              description="Import input is prefilled. Add repo URL and what failed."
              variant="outline"
              size="xs"
              className="font-bold text-[11px] border-line-strong"
            >
              Report import issue
            </ReportIssueButton>
          ) : null
        }
      />

      {importPreview && <ProfileDialog label="Review imported project" busy={saveMutation.isPending} onRequestClose={() => setImportPreview(null)}>
            <div className="profile-entry-form space-y-4">
              <div className="mb-4 flex items-start justify-between gap-3 border-b border-line pb-3">
                <div>
                  <p className="text-xs font-bold text-[#ff4e26]">
                    GitHub import staged
                  </p>
                  <h3 className="text-lg font-bold tracking-tight text-ink">
                    {importPreview.name || "Untitled project"}
                  </h3>
                  <p className="mt-1 text-sm font-semibold text-ink-muted">
                    Review these extracted details and save directly, or edit the form below.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setImportPreview(null)} aria-label="Close import preview"
                  className="border-transparent"
                >
                  <X size={16} />
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="border border-line bg-ink/[0.03] p-3 rounded-md">
                  <p className="text-xs font-bold text-ink-muted">
                    Description added
                  </p>
                  <p className="mt-1 text-sm font-semibold text-ink">
                    {importPreview.description || "No description found."}
                  </p>
                </div>
                <div className="border border-line bg-ink/[0.03] p-3 rounded-md">
                  <p className="text-xs font-bold text-ink-muted">
                    Tech added
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(importPreview.technologies?.length
                      ? importPreview.technologies
                      : ["No technologies found"]
                    ).map((tech) => (
                      <span
                        key={tech}
                        className="border border-line bg-paper px-2 py-0.5 text-[10px] font-bold text-ink rounded-md"
                      >
                        {tech}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="border border-line bg-ink/[0.03] p-3 md:col-span-2 rounded-md">
                  <p className="text-xs font-bold text-ink-muted">
                    Impact bullets added
                  </p>
                  {importPreview.bullet_points?.length ? (
                    <ul className="mt-2 list-inside list-disc space-y-1 text-sm font-semibold text-ink">
                      {importPreview.bullet_points.map((bullet, index) => (
                        <li key={index}>{bullet}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm font-semibold text-ink-muted">
                      No bullets found.
                    </p>
                  )}
                </div>
                {importPreview.warnings?.length ? (
                  <div className="border border-yellow-300 dark:border-yellow-700/60 bg-yellow-50 dark:bg-yellow-950/40 p-3 md:col-span-2 rounded-md">
                    <p className="text-xs font-bold text-yellow-900 dark:text-yellow-300">
                      Import notes
                    </p>
                    <ul className="mt-1 list-inside list-disc space-y-1 text-sm font-semibold text-yellow-950 dark:text-yellow-200">
                      {importPreview.warnings.map((warning, index) => (
                        <li key={`${warning.scope}-${index}`}>{warning.message}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {importPreview.duplicate_candidates?.[0] && (
                  <div className="border border-yellow-300 dark:border-yellow-700/60 bg-yellow-50 dark:bg-yellow-950/40 p-3 md:col-span-2 rounded-md">
                    <p className="text-xs font-bold text-yellow-900 dark:text-yellow-300">
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

              <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
                <Button
                  type="button"
                  onClick={handleDirectSaveImport}
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? (
                    <>
                      <Loader2 className="animate-spin" size={16} /> Saving...
                    </>
                  ) : (
                    "Save Project"
                  )}
                </Button>
                <Button type="button" variant="outline" onClick={() => setImportPreview(null)}>
                  Edit
                </Button>
                <Button type="button" variant="ghost" onClick={requestClose}>
                  Discard Import
                </Button>
              </div>
            </div>
      </ProfileDialog>}

      {isAdding && !editingId && !importPreview && renderForm()}

      <div className="space-y-3">
        {projects.map((proj) => (
          <div key={proj.id} className="">
            <div className="flex items-start justify-between gap-3 rounded-md border border-line bg-paper p-4 shadow-soft transition-colors hover:border-ember/40 md:px-6 md:py-5">
              <div className="min-w-0 space-y-1">
                <h4 className="text-base font-bold tracking-tight text-ink md:text-[17px]">
                  {proj.name}
                </h4>
                {proj.technologies && proj.technologies.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {proj.technologies.map((t: string) => (
                      <span
                        key={t}
                        className="border border-line bg-ink/[0.03] px-1.5 py-0.5 text-[9px] font-bold text-ink-muted rounded-md"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-xs font-semibold text-ink mt-1 ">
                  {proj.description}
                </p>
                {proj.bullet_points && proj.bullet_points.length > 0 && (
                  <ul className="mt-1 list-outside list-disc space-y-1 pl-4 text-[13px] leading-relaxed text-ink/85 marker:text-ember/60">
                    {proj.bullet_points.map((b: string, i: number) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-3 mt-2 text-xs font-bold text-ink-muted">
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
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => startEdit(proj)}
                  className="h-9 w-9 p-0 border-transparent hover:border-ink/40 dark:hover:border-ember/50"
                  title="Edit project"
                >
                  <Edit2 size={15} className="text-ink" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => {
                    if (confirm("Delete this entry? This cannot be undone."))
                      deleteMutation.mutate(proj.id);
                  }}
                  disabled={deleteMutation.isPending}
                  className="h-9 w-9 p-0 border-transparent hover:border-red-500 hover:text-red-500"
                  title="Delete project"
                >
                  <Trash2 size={15} />
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
