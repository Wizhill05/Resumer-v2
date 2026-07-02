"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FolderGit2, Loader2, Plus, Trash2, Edit2, X } from "lucide-react";

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

export function ProjectForm() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [githubUrl, setGithubUrl] = useState("");
  const [githubMessage, setGithubMessage] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportedProject | null>(
    null,
  );

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
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

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
    mutationFn: async (url: string) => {
      const res = await fetch("/api/backend/profile/import/github-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
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

  const handleCancel = () => {
    reset();
    setEditingId(null);
    setIsAdding(false);
    setImportPreview(null);
  };

  const renderForm = () => (
    <form
      onSubmit={handleSubmit((data) => saveMutation.mutate(data))}
      className="space-y-4 border border-zinc-200 bg-zinc-50 p-4 pixel-enter"
    >
      <div className="mb-1 flex items-center justify-between border-b border-zinc-200 pb-2">
        <h3 className="font-semibold text-black uppercase tracking-tight">
          {editingId ? "Edit Project" : "Add Project"}
        </h3>
        <Button
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
            <p className="text-red-600 text-xs font-bold">
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
            <p className="text-red-600 text-xs font-bold">
              {errors.github_url.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="live_url">Live URL</Label>
          <Input id="live_url" {...register("live_url")} />
          {errors.live_url && (
            <p className="text-red-600 text-xs font-bold">
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

      <div className="flex gap-3 border-t border-zinc-200 pt-3">
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

  return (
    <div className="space-y-4 pixel-enter">
      {!isAdding && (
        <div className="space-y-4 border border-zinc-950 bg-white p-4 shadow-[4px_4px_0px_#18181b]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <p className="text-xs font-extrabold uppercase tracking-widest text-[#ff4e26]">
                Project import
              </p>
              <h3 className="text-xl font-extrabold uppercase tracking-tight text-black">
                Import using GitHub
              </h3>
              <p className="max-w-xl text-sm font-semibold text-zinc-600">
                Paste a repo link. We read metadata, languages, README, and
                project files, then stage a resume-ready project for review.
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
          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <Input
              value={githubUrl}
              onChange={(event) => setGithubUrl(event.target.value)}
              placeholder="https://github.com/owner/repo"
              className="h-11 text-base font-semibold"
            />
            <Button
              type="button"
              size="lg"
              onClick={() => githubImportMutation.mutate(githubUrl)}
              disabled={githubImportMutation.isPending || !githubUrl.trim()}
            >
              {githubImportMutation.isPending ? (
                <>
                  <Loader2 className="animate-spin" size={18} /> Reading repo...
                </>
              ) : (
                <>
                  <FolderGit2 size={18} /> Import Using GitHub
                </>
              )}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] font-extrabold uppercase tracking-wide text-zinc-500">
            <span>{projects.length} saved projects</span>
            <span>README aware</span>
            <span>Duplicate checks</span>
            <span>Review before save</span>
          </div>
          {githubMessage && (
            <p className="border border-zinc-200 bg-zinc-50 p-2 text-xs font-bold text-zinc-700">
              {githubMessage}
            </p>
          )}
        </div>
      )}

      {importPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto border border-zinc-950 bg-white p-4 shadow-[6px_6px_0px_#18181b] md:p-5">
            <div className="mb-4 flex items-start justify-between gap-3 border-b border-zinc-200 pb-3">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-widest text-[#ff4e26]">
                  GitHub import staged
                </p>
                <h3 className="text-lg font-extrabold uppercase tracking-tight">
                  {importPreview.name || "Untitled project"}
                </h3>
                <p className="mt-1 text-sm font-semibold text-zinc-600">
                  Review these extracted details, then save the form below to
                  add it.
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
              <div className="border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-extrabold uppercase tracking-wide text-zinc-500">
                  Description added
                </p>
                <p className="mt-1 text-sm font-semibold text-zinc-800">
                  {importPreview.description || "No description found."}
                </p>
              </div>
              <div className="border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-extrabold uppercase tracking-wide text-zinc-500">
                  Tech added
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(importPreview.technologies?.length
                    ? importPreview.technologies
                    : ["No technologies found"]
                  ).map((tech) => (
                    <span
                      key={tech}
                      className="border border-zinc-300 bg-white px-2 py-0.5 text-[10px] font-extrabold uppercase text-zinc-700"
                    >
                      {tech}
                    </span>
                  ))}
                </div>
              </div>
              <div className="border border-zinc-200 bg-zinc-50 p-3 md:col-span-2">
                <p className="text-xs font-extrabold uppercase tracking-wide text-zinc-500">
                  Impact bullets added
                </p>
                {importPreview.bullet_points?.length ? (
                  <ul className="mt-2 list-inside list-disc space-y-1 text-sm font-semibold text-zinc-800">
                    {importPreview.bullet_points.map((bullet, index) => (
                      <li key={index}>{bullet}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm font-semibold text-zinc-600">
                    No bullets found.
                  </p>
                )}
              </div>
              {importPreview.duplicate_candidates?.[0] && (
                <div className="border border-yellow-300 bg-yellow-50 p-3 md:col-span-2">
                  <p className="text-xs font-extrabold uppercase tracking-wide text-yellow-900">
                    Possible duplicate
                  </p>
                  <p className="mt-1 text-sm font-bold text-yellow-950">
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

            <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-200 pt-3">
              <Button type="button" onClick={() => setImportPreview(null)}>
                Review Form
              </Button>
              <Button type="button" variant="outline" onClick={handleCancel}>
                Discard Import
              </Button>
            </div>
          </div>
        </div>
      )}

      {isAdding && !editingId && renderForm()}

      <div className="space-y-3">
        {projects.map((proj) => (
          <div key={proj.id} className="space-y-3">
            <div className="flex items-start justify-between gap-3 border border-zinc-200 bg-white p-3 transition-colors hover:border-zinc-400 md:p-4">
              <div className="min-w-0 space-y-1.5">
                <h4 className="text-base font-extrabold uppercase tracking-tight text-black">
                  {proj.name}
                </h4>
                {proj.technologies && proj.technologies.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {proj.technologies.map((t: string) => (
                      <span
                        key={t}
                        className="border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-bold uppercase text-zinc-600"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-sm font-semibold text-zinc-700 mt-2">
                  {proj.description}
                </p>
                {proj.bullet_points && proj.bullet_points.length > 0 && (
                  <ul className="mt-2 list-inside list-disc space-y-1 text-xs font-medium text-zinc-600">
                    {proj.bullet_points.map((b: string, i: number) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-4 mt-3 text-xs font-bold uppercase tracking-wider text-zinc-600">
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
                  className="border-transparent hover:border-black"
                >
                  <Edit2 size={14} className="text-black" />
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
