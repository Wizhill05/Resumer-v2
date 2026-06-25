"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Plus, Trash2, Edit2, X } from "lucide-react"

const schema = z.object({
  degree: z.string().min(1, "Degree is required"),
  institution: z.string().min(1, "Institution/School is required"),
  location: z.string().optional(),
  start_date: z.string().or(z.literal("")), // ISO date string (YYYY-MM-DD) or empty
  end_date: z.string().or(z.literal("")),
  gpa: z.string().optional(),
  coursework: z.string().optional(), // Raw comma-separated string for coursework
  sort_order: z.number().optional(),
})

type FormData = z.infer<typeof schema>

type EducationItem = {
  id: string
  degree: string
  institution: string
  location?: string
  start_date?: string
  end_date?: string
  gpa?: string
  coursework?: string[]
  sort_order?: number
}

export function EducationForm() {
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)

  const { data: educationList = [], isLoading } = useQuery<EducationItem[]>({
    queryKey: ["education"],
    queryFn: async () => {
      const res = await fetch("/api/backend/profile/education")
      if (!res.ok) throw new Error("Failed to load education entries")
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
        coursework: data.coursework
          ? data.coursework.split(",").map((c) => c.trim()).filter(Boolean)
          : [],
      }

      const url = editingId
        ? `/api/backend/profile/education/${editingId}`
        : "/api/backend/profile/education"
      const method = editingId ? "PUT" : "POST"

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error("Failed to save education entry")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["education"] })
      reset()
      setEditingId(null)
      setIsAdding(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/backend/profile/education/${id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error("Failed to delete education entry")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["education"] })
    },
  })

  const startEdit = (edu: EducationItem) => {
    setEditingId(edu.id)
    setIsAdding(true)
    reset({
      degree: edu.degree,
      institution: edu.institution,
      location: edu.location || "",
      start_date: edu.start_date || "",
      end_date: edu.end_date || "",
      gpa: edu.gpa || "",
      coursework: edu.coursework ? edu.coursework.join(", ") : "",
      sort_order: edu.sort_order || 0,
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
            {educationList.length} education entries
          </h3>
          <Button
            onClick={() => {
              setIsAdding(true)
              setEditingId(null)
              reset({
                degree: "",
                institution: "",
                location: "",
                start_date: "",
                end_date: "",
                gpa: "",
                coursework: "",
                sort_order: educationList.length,
              })
            }}
            size="sm"
          >
            <Plus size={14} /> Add Education
          </Button>
        </div>
      )}

      {isAdding && (
        <form onSubmit={handleSubmit((data) => saveMutation.mutate(data))} className="space-y-6 p-6 border border-zinc-100 rounded-3xl bg-[#fdfbf7]/50">
          <div className="flex justify-between items-center mb-2 border-b border-zinc-150 pb-3">
            <h3 className="font-semibold text-black uppercase tracking-tight">
              {editingId ? "Edit Education" : "Add Education"}
            </h3>
            <Button type="button" variant="ghost" size="icon-sm" onClick={handleCancel} className="border-none hover:bg-zinc-200/50">
              <X size={16} />
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="degree">Degree / Major</Label>
              <Input id="degree" placeholder="e.g. B.S. in Computer Science" {...register("degree")} />
              {errors.degree && <p className="text-red-600 text-xs font-bold">{errors.degree.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="institution">Institution / School</Label>
              <Input id="institution" placeholder="e.g. Stanford University" {...register("institution")} />
              {errors.institution && <p className="text-red-600 text-xs font-bold">{errors.institution.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Input id="location" placeholder="e.g. Stanford, CA" {...register("location")} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="gpa">GPA</Label>
              <Input id="gpa" placeholder="e.g. 3.8 / 4.0" {...register("gpa")} />
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

            <div className="space-y-2">
              <Label htmlFor="coursework">Related Coursework (comma separated)</Label>
              <Input id="coursework" placeholder="Algorithms, Database Systems" {...register("coursework")} />
            </div>
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
        {educationList.map((edu) => (
          <div key={edu.id} className="editorial-card p-6 flex justify-between items-start bg-white">
            <div className="space-y-2">
              <h4 className="font-heading text-lg font-bold text-zinc-900 uppercase tracking-tight">{edu.degree}</h4>
              <p className="text-sm font-bold text-zinc-600 uppercase tracking-wide">
                {edu.institution} — <span className="text-zinc-500 normal-case font-medium">{edu.location || "Location N/A"}</span>
              </p>
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                {edu.start_date || "Start N/A"} to {edu.end_date || "Present"}
              </p>
              {edu.gpa && <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">GPA: {edu.gpa}</p>}
              {edu.coursework && edu.coursework.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {edu.coursework.map((c: string) => (
                    <Badge key={c} variant="secondary" className="text-[9px] font-bold py-0 px-2 tracking-wider">
                      {c}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="icon-sm" variant="ghost" onClick={() => startEdit(edu)} className="border-none hover:bg-zinc-100">
                <Edit2 size={14} className="text-zinc-700" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => {
                  if (confirm("Are you sure?")) deleteMutation.mutate(edu.id)
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
