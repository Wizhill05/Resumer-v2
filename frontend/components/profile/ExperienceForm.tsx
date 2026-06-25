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
import { Plus, Trash2, Edit2, X } from "lucide-react"

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

type ExperienceItem = {
  id: string
  role: string
  organization: string
  location?: string
  start_date?: string
  end_date?: string
  bullet_points?: string[]
  sort_order?: number
}

export function ExperienceForm() {
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)

  const { data: experiences = [], isLoading } = useQuery<ExperienceItem[]>({
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

  const startEdit = (exp: ExperienceItem) => {
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
          >
            <Plus size={14} /> Add Experience
          </Button>
        </div>
      )}

      {isAdding && (
        <form onSubmit={handleSubmit((data) => saveMutation.mutate(data))} className="space-y-6 p-6 border border-zinc-100 rounded-3xl bg-[#fdfbf7]/50">
          <div className="flex justify-between items-center mb-2 border-b border-zinc-150 pb-3">
            <h3 className="font-heading text-lg font-bold text-zinc-900 uppercase">
              {editingId ? "Edit Experience" : "Add Experience"}
            </h3>
            <Button type="button" variant="ghost" size="icon-sm" onClick={handleCancel} className="border-none hover:bg-zinc-200/50">
              <X size={16} />
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="role">Role / Job Title</Label>
              <Input id="role" {...register("role")} />
              {errors.role && <p className="text-red-600 text-xs font-bold">{errors.role.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="organization">Company / Organization</Label>
              <Input id="organization" {...register("organization")} />
              {errors.organization && <p className="text-red-600 text-xs font-bold">{errors.organization.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Input id="location" placeholder="e.g. Remote, or New York, NY" {...register("location")} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sort_order">Sort Order (lower = higher priority)</Label>
              <Input id="sort_order" type="number" {...register("sort_order", { valueAsNumber: true })} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="start_date">Start Date</Label>
              <Input id="start_date" type="date" {...register("start_date")} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="end_date">End Date (leave blank for Present)</Label>
              <Input id="end_date" type="date" {...register("end_date")} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bullet_points">Bullet Points (one per line)</Label>
            <Textarea
              id="bullet_points"
              rows={5}
              placeholder="- Developed backend microservices using FastAPI&#10;- Configured PostgreSQL database and Alembic migrations"
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
        {experiences.map((exp) => (
          <div key={exp.id} className="editorial-card p-6 flex justify-between items-start bg-white">
            <div className="space-y-2">
              <h4 className="font-heading text-lg font-bold text-zinc-900 uppercase tracking-tight">{exp.role}</h4>
              <p className="text-sm font-bold text-zinc-600 uppercase tracking-wide">
                {exp.organization} — <span className="text-zinc-500 normal-case font-medium">{exp.location || "Location N/A"}</span>
              </p>
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                {exp.start_date || "Start N/A"} to {exp.end_date || "Present"}
              </p>
              {exp.bullet_points && exp.bullet_points.length > 0 && (
                <ul className="list-disc list-inside mt-3 text-xs font-semibold text-zinc-600 space-y-1">
                  {exp.bullet_points.map((b: string, i: number) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="icon-sm" variant="ghost" onClick={() => startEdit(exp)} className="border-none hover:bg-zinc-100">
                <Edit2 size={14} className="text-zinc-700" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => {
                  if (confirm("Are you sure?")) deleteMutation.mutate(exp.id)
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
