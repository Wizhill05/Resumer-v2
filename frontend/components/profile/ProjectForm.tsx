"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Plus, Trash2, Edit2, X } from "lucide-react"

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
})

type FormData = z.infer<typeof schema>

type ProjectItem = {
  id: string
  name: string
  description?: string
  technologies?: string[]
  github_url?: string
  live_url?: string
  start_date?: string
  end_date?: string
  bullet_points?: string[]
  sort_order?: number
}

export function ProjectForm() {
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)

  const { data: projects = [], isLoading } = useQuery<ProjectItem[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/backend/profile/projects")
      if (!res.ok) throw new Error("Failed to load projects")
      return res.json()
    },
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const saveMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const payload = {
        ...data,
        sort_order: data.sort_order ?? 0,
        start_date: data.start_date || null,
        end_date: data.end_date || null,
        technologies: data.technologies
          ? data.technologies.split(",").map((t) => t.trim()).filter(Boolean)
          : [],
        bullet_points: data.bullet_points
          ? data.bullet_points.split("\n").map((b) => b.trim()).filter(Boolean)
          : [],
      }

      const url = editingId
        ? `/api/backend/profile/projects/${editingId}`
        : "/api/backend/profile/projects"
      const method = editingId ? "PUT" : "POST"

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error("Failed to save project")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] })
      reset()
      setEditingId(null)
      setIsAdding(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/backend/profile/projects/${id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error("Failed to delete project")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] })
    },
  })

  const startEdit = (project: ProjectItem) => {
    setEditingId(project.id)
    setIsAdding(true)
    reset({
      name: project.name,
      description: project.description || "",
      technologies: project.technologies ? project.technologies.join(", ") : "",
      github_url: project.github_url || "",
      live_url: project.live_url || "",
      start_date: project.start_date || "",
      end_date: project.end_date || "",
      bullet_points: project.bullet_points ? project.bullet_points.join("\n") : "",
      sort_order: project.sort_order || 0,
    })
  }

  const handleCancel = () => {
    reset()
    setEditingId(null)
    setIsAdding(false)
  }

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <div className="flex gap-2">
          <span className="w-3 h-3 bg-[#ff4e26] rounded-full pulse-dot-1" />
          <span className="w-3 h-3 bg-zinc-350 rounded-full pulse-dot-2" />
          <span className="w-3 h-3 bg-[#ff4e26] rounded-full pulse-dot-3" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {!isAdding && (
        <div className="flex justify-between items-center bg-[#fdfbf7] p-4 border border-zinc-200/60 rounded-2xl">
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
            {projects.length} project entries
          </h3>
          <Button
            onClick={() => {
              setIsAdding(true)
              setEditingId(null)
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
              })
            }}
            size="sm"
          >
            <Plus size={14} /> Add Project
          </Button>
        </div>
      )}

      {isAdding && (
        <form onSubmit={handleSubmit((data) => saveMutation.mutate(data))} className="space-y-6 p-6 border border-zinc-100 rounded-3xl bg-[#fdfbf7]/50">
          <div className="flex justify-between items-center mb-2 border-b border-zinc-150 pb-3">
            <h3 className="font-heading text-lg font-bold text-zinc-900 uppercase">
              {editingId ? "Edit Project" : "Add Project"}
            </h3>
            <Button type="button" variant="ghost" size="icon-sm" onClick={handleCancel} className="border-none hover:bg-zinc-200/50">
              <X size={16} />
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Project Name</Label>
              <Input id="name" {...register("name")} />
              {errors.name && <p className="text-red-600 text-xs font-bold">{errors.name.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="technologies">Technologies (comma separated)</Label>
              <Input id="technologies" placeholder="React, TS, TailWind" {...register("technologies")} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="github_url">GitHub URL</Label>
              <Input id="github_url" {...register("github_url")} />
              {errors.github_url && <p className="text-red-600 text-xs font-bold">{errors.github_url.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="live_url">Live URL</Label>
              <Input id="live_url" {...register("live_url")} />
              {errors.live_url && <p className="text-red-600 text-xs font-bold">{errors.live_url.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="start_date">Start Date</Label>
              <Input id="start_date" type="date" {...register("start_date")} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="end_date">End Date</Label>
              <Input id="end_date" type="date" {...register("end_date")} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sort_order">Sort Order</Label>
              <Input id="sort_order" type="number" {...register("sort_order", { valueAsNumber: true })} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Short Description</Label>
            <Textarea id="description" rows={3} {...register("description")} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="bullet_points">Bullet Points / Key Features (one per line)</Label>
            <Textarea
              id="bullet_points"
              rows={4}
              placeholder="- Built real-time dashboard using Socket.io&#10;- Integrated Stripe payments API"
              {...register("bullet_points")}
            />
          </div>

          <div className="flex gap-3 pt-4 border-t border-zinc-150">
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
            <Button type="button" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      <div className="space-y-4">
        {projects.map((proj) => (
          <div key={proj.id} className="editorial-card p-6 flex justify-between items-start bg-white">
            <div className="space-y-2">
              <h4 className="font-heading text-lg font-bold text-zinc-900 uppercase tracking-tight">{proj.name}</h4>
              {proj.technologies && proj.technologies.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {proj.technologies.map((t: string) => (
                    <Badge key={t} variant="secondary" className="text-[9px] font-bold py-0 px-2 tracking-wider">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-sm font-semibold text-zinc-650 mt-2">{proj.description}</p>
              {proj.bullet_points && proj.bullet_points.length > 0 && (
                <ul className="list-disc list-inside mt-3 text-xs font-semibold text-zinc-600 space-y-1">
                  {proj.bullet_points.map((b: string, i: number) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              )}
              <div className="flex gap-4 mt-3 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                {proj.github_url && <a href={proj.github_url} target="_blank" rel="noreferrer" className="underline hover:text-[#ff4e26]">GitHub</a>}
                {proj.live_url && <a href={proj.live_url} target="_blank" rel="noreferrer" className="underline hover:text-[#ff4e26]">Live Site</a>}
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="icon-sm" variant="ghost" onClick={() => startEdit(proj)} className="border-none hover:bg-zinc-100">
                <Edit2 size={14} className="text-zinc-700" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => {
                  if (confirm("Are you sure?")) deleteMutation.mutate(proj.id)
                }}
                className="border-none hover:bg-red-50 hover:text-red-500"
              >
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
