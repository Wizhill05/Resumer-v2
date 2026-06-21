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
import { Loader2, Plus, Trash2, Edit2, X } from "lucide-react"

const schema = z.object({
  role: z.string().min(1, "Role/Title is required"),
  organization: z.string().min(1, "Company/Organization is required"),
  location: z.string().optional(),
  start_date: z.string().or(z.literal("")), // ISO date string (YYYY-MM-DD) or empty
  end_date: z.string().or(z.literal("")),
  bullet_points: z.string().optional(), // Raw newlines string for editing
  sort_order: z.number().optional(),
})

type FormData = z.infer<typeof schema>

export function ExperienceForm() {
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)

  const { data: experiences = [], isLoading } = useQuery<any[]>({
    queryKey: ["experiences"],
    queryFn: async () => {
      const res = await fetch("/api/backend/profile/experiences")
      if (!res.ok) throw new Error("Failed to load experiences")
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
        bullet_points: data.bullet_points
          ? data.bullet_points.split("\n").map((b) => b.trim()).filter(Boolean)
          : [],
      }

      const url = editingId
        ? `/api/backend/profile/experiences/${editingId}`
        : "/api/backend/profile/experiences"
      const method = editingId ? "PUT" : "POST"

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error("Failed to save experience")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["experiences"] })
      reset()
      setEditingId(null)
      setIsAdding(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/backend/profile/experiences/${id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error("Failed to delete experience")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["experiences"] })
    },
  })

  const startEdit = (exp: any) => {
    setEditingId(exp.id)
    setIsAdding(true)
    reset({
      role: exp.role,
      organization: exp.organization,
      location: exp.location || "",
      start_date: exp.start_date || "",
      end_date: exp.end_date || "",
      bullet_points: exp.bullet_points ? exp.bullet_points.join("\n") : "",
      sort_order: exp.sort_order || 0,
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
        <Loader2 className="animate-spin text-zinc-400" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {!isAdding && (
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-medium text-zinc-400">
            {experiences.length} experience entries
          </h3>
          <Button
            onClick={() => {
              setIsAdding(true)
              setEditingId(null)
              reset({
                role: "",
                organization: "",
                location: "",
                start_date: "",
                end_date: "",
                bullet_points: "",
                sort_order: experiences.length,
              })
            }}
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-white flex gap-1 items-center"
          >
            <Plus size={16} /> Add Experience
          </Button>
        </div>
      )}

      {isAdding && (
        <form onSubmit={handleSubmit((data) => saveMutation.mutate(data))} className="space-y-4 p-4 border border-zinc-800 rounded-lg bg-zinc-900/40">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-semibold text-white">
              {editingId ? "Edit Experience" : "Add Experience"}
            </h3>
            <Button type="button" variant="ghost" size="sm" onClick={handleCancel}>
              <X size={16} />
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="role">Role / Job Title</Label>
              <Input id="role" {...register("role")} className="bg-zinc-900 border-zinc-800 text-white" />
              {errors.role && <p className="text-red-400 text-xs">{errors.role.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="organization">Company / Organization</Label>
              <Input id="organization" {...register("organization")} className="bg-zinc-900 border-zinc-800 text-white" />
              {errors.organization && <p className="text-red-400 text-xs">{errors.organization.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Input id="location" placeholder="e.g. Remote, or New York, NY" {...register("location")} className="bg-zinc-900 border-zinc-800 text-white" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sort_order">Sort Order (lower = higher priority)</Label>
              <Input id="sort_order" type="number" {...register("sort_order", { valueAsNumber: true })} className="bg-zinc-900 border-zinc-800 text-white" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="start_date">Start Date</Label>
              <Input id="start_date" type="date" {...register("start_date")} className="bg-zinc-900 border-zinc-800 text-white" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="end_date">End Date (leave blank for Present)</Label>
              <Input id="end_date" type="date" {...register("end_date")} className="bg-zinc-900 border-zinc-800 text-white" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bullet_points">Bullet Points (one per line)</Label>
            <Textarea
              id="bullet_points"
              rows={5}
              placeholder="- Developed backend microservices using FastAPI&#10;- Configured PostgreSQL database and Alembic migrations"
              {...register("bullet_points")}
              className="bg-zinc-900 border-zinc-800 text-white"
            />
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={saveMutation.isPending} className="bg-blue-600 hover:bg-blue-700 text-white">
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
            <Button type="button" variant="outline" onClick={handleCancel} className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 bg-transparent">
              Cancel
            </Button>
          </div>
        </form>
      )}

      <div className="space-y-4">
        {experiences.map((exp) => (
          <div key={exp.id} className="p-4 border border-zinc-800 rounded-lg bg-zinc-900/20 flex justify-between items-start">
            <div className="space-y-1">
              <h4 className="font-semibold text-white">{exp.role}</h4>
              <p className="text-sm text-zinc-300">
                {exp.organization} — <span className="text-zinc-400">{exp.location || "Location N/A"}</span>
              </p>
              <p className="text-xs text-zinc-500">
                {exp.start_date || "Start N/A"} to {exp.end_date || "Present"}
              </p>
              {exp.bullet_points && exp.bullet_points.length > 0 && (
                <ul className="list-disc list-inside mt-2 text-xs text-zinc-400 space-y-1">
                  {exp.bullet_points.map((b: string, i: number) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="icon" variant="ghost" onClick={() => startEdit(exp)} className="text-zinc-400 hover:text-white">
                <Edit2 size={16} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  if (confirm("Are you sure?")) deleteMutation.mutate(exp.id)
                }}
                className="text-zinc-400 hover:text-red-400"
              >
                <Trash2 size={16} />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
