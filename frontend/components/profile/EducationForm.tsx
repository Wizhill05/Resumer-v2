"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Plus, Trash2, Edit2, X } from "lucide-react"

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

export function EducationForm() {
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)

  const { data: educationList = [], isLoading } = useQuery<any[]>({
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

  const startEdit = (edu: any) => {
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
        <Loader2 className="animate-spin text-zinc-400" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {!isAdding && (
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-medium text-zinc-400">
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
            className="bg-blue-600 hover:bg-blue-700 text-white flex gap-1 items-center"
          >
            <Plus size={16} /> Add Education
          </Button>
        </div>
      )}

      {isAdding && (
        <form onSubmit={handleSubmit((data) => saveMutation.mutate(data))} className="space-y-4 p-4 border border-zinc-800 rounded-lg bg-zinc-900/40">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-semibold text-white">
              {editingId ? "Edit Education" : "Add Education"}
            </h3>
            <Button type="button" variant="ghost" size="sm" onClick={handleCancel}>
              <X size={16} />
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="degree">Degree / Major</Label>
              <Input id="degree" placeholder="e.g. B.S. in Computer Science" {...register("degree")} className="bg-zinc-900 border-zinc-800 text-white" />
              {errors.degree && <p className="text-red-400 text-xs">{errors.degree.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="institution">Institution / School</Label>
              <Input id="institution" placeholder="e.g. Stanford University" {...register("institution")} className="bg-zinc-900 border-zinc-800 text-white" />
              {errors.institution && <p className="text-red-400 text-xs">{errors.institution.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Input id="location" placeholder="e.g. Stanford, CA" {...register("location")} className="bg-zinc-900 border-zinc-800 text-white" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="gpa">GPA</Label>
              <Input id="gpa" placeholder="e.g. 3.8 / 4.0" {...register("gpa")} className="bg-zinc-900 border-zinc-800 text-white" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="start_date">Start Date</Label>
              <Input id="start_date" type="date" {...register("start_date")} className="bg-zinc-900 border-zinc-800 text-white" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="end_date">End Date</Label>
              <Input id="end_date" type="date" {...register("end_date")} className="bg-zinc-900 border-zinc-800 text-white" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sort_order">Sort Order</Label>
              <Input id="sort_order" type="number" {...register("sort_order", { valueAsNumber: true })} className="bg-zinc-900 border-zinc-800 text-white" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="coursework">Related Coursework (comma separated)</Label>
              <Input id="coursework" placeholder="Algorithms, Database Systems" {...register("coursework")} className="bg-zinc-900 border-zinc-800 text-white" />
            </div>
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
        {educationList.map((edu) => (
          <div key={edu.id} className="p-4 border border-zinc-800 rounded-lg bg-zinc-900/20 flex justify-between items-start">
            <div className="space-y-1">
              <h4 className="font-semibold text-white">{edu.degree}</h4>
              <p className="text-sm text-zinc-300">
                {edu.institution} — <span className="text-zinc-400">{edu.location || "Location N/A"}</span>
              </p>
              <p className="text-xs text-zinc-500">
                {edu.start_date || "Start N/A"} to {edu.end_date || "Present"}
              </p>
              {edu.gpa && <p className="text-xs text-zinc-400 mt-1">GPA: {edu.gpa}</p>}
              {edu.coursework && edu.coursework.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {edu.coursework.map((c: string) => (
                    <span key={c} className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="icon" variant="ghost" onClick={() => startEdit(edu)} className="text-zinc-400 hover:text-white">
                <Edit2 size={16} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  if (confirm("Are you sure?")) deleteMutation.mutate(edu.id)
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
