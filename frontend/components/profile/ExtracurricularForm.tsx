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
  title: z.string().min(1, "Title/Activity Name is required"),
  organization: z.string().optional(),
  description: z.string().optional(),
  start_date: z.string().or(z.literal("")), // ISO date string (YYYY-MM-DD) or empty
  end_date: z.string().or(z.literal("")),
  bullet_points: z.string().optional(), // Raw newlines string for editing
  sort_order: z.number().optional(),
})

type FormData = z.infer<typeof schema>

type ExtracurricularItem = {
  id: string
  title: string
  organization?: string
  description?: string
  start_date?: string
  end_date?: string
  bullet_points?: string[]
  sort_order?: number
}

export function ExtracurricularForm() {
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)

  const { data: extracurriculars = [], isLoading } = useQuery<ExtracurricularItem[]>({
    queryKey: ["extracurriculars"],
    queryFn: async () => {
      const res = await fetch("/api/backend/profile/extracurriculars")
      if (!res.ok) throw new Error("Failed to load extracurricular activities")
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
        ? `/api/backend/profile/extracurriculars/${editingId}`
        : "/api/backend/profile/extracurriculars"
      const method = editingId ? "PUT" : "POST"

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error("Failed to save extracurricular activity")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["extracurriculars"] })
      reset()
      setEditingId(null)
      setIsAdding(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/backend/profile/extracurriculars/${id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error("Failed to delete extracurricular activity")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["extracurriculars"] })
    },
  })

  const startEdit = (ex: ExtracurricularItem) => {
    setEditingId(ex.id)
    setIsAdding(true)
    reset({
      title: ex.title,
      organization: ex.organization || "",
      description: ex.description || "",
      start_date: ex.start_date || "",
      end_date: ex.end_date || "",
      bullet_points: ex.bullet_points ? ex.bullet_points.join("\n") : "",
      sort_order: ex.sort_order || 0,
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
          <span className="w-3 h-3 bg-zinc-355 rounded-full pulse-dot-2" />
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
            {extracurriculars.length} entries
          </h3>
          <Button
            onClick={() => {
              setIsAdding(true)
              setEditingId(null)
              reset({
                title: "",
                organization: "",
                description: "",
                start_date: "",
                end_date: "",
                bullet_points: "",
                sort_order: extracurriculars.length,
              })
            }}
            size="sm"
          >
            <Plus size={14} /> Add Activity
          </Button>
        </div>
      )}

      {isAdding && (
        <form onSubmit={handleSubmit((data) => saveMutation.mutate(data))} className="space-y-6 p-6 border border-zinc-100 rounded-3xl bg-[#fdfbf7]/50">
          <div className="flex justify-between items-center mb-2 border-b border-zinc-150 pb-3">
            <h3 className="font-semibold text-black uppercase tracking-tight">
              {editingId ? "Edit Activity / Achievement" : "Add Activity / Achievement"}
            </h3>
            <Button type="button" variant="ghost" size="icon-sm" onClick={handleCancel} className="border-none hover:bg-zinc-200/50">
              <X size={16} />
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title / Activity / Award</Label>
              <Input id="title" {...register("title")} />
              {errors.title && <p className="text-red-600 text-xs font-bold">{errors.title.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="organization">Organization / Issuer</Label>
              <Input id="organization" {...register("organization")} />
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
            <Label htmlFor="description">Brief Description (Optional)</Label>
            <Textarea
              id="description"
              rows={2}
              {...register("description")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="bullet_points">Bullet Points (Optional, one per line)</Label>
            <Textarea
              id="bullet_points"
              rows={4}
              placeholder="- Won 1st place out of 50 teams at hackathon&#10;- Organized weekly technical workshops for 100+ students"
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
        {extracurriculars.map((ex) => (
          <div key={ex.id} className="editorial-card p-6 flex justify-between items-start bg-white">
            <div className="space-y-2">
              <h4 className="font-heading text-lg font-bold text-zinc-900 uppercase tracking-tight">{ex.title}</h4>
              {ex.organization && (
                <p className="text-sm font-bold text-zinc-600 uppercase tracking-wide">
                  {ex.organization}
                </p>
              )}
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                {ex.start_date || "N/A"} to {ex.end_date || "Present"}
              </p>
              {ex.description && (
                <p className="text-xs font-semibold text-[#ff4e26] mt-1 italic">{ex.description}</p>
              )}
              {ex.bullet_points && ex.bullet_points.length > 0 && (
                <ul className="list-disc list-inside mt-3 text-xs font-semibold text-zinc-600 space-y-1">
                  {ex.bullet_points.map((b: string, i: number) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="icon-sm" variant="ghost" onClick={() => startEdit(ex)} className="border-none hover:bg-zinc-100">
                <Edit2 size={14} className="text-zinc-700" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => {
                  if (confirm("Are you sure?")) deleteMutation.mutate(ex.id)
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
