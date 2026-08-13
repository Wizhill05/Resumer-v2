"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Plus, Trash2, Edit2, X } from "lucide-react"
import { SaveStatusBadge, SaveStatus } from "./SaveStatusBadge"

const schema = z.object({
  degree: z.string().min(1, "Degree/Field of study is required"),
  institution: z.string().min(1, "School/Institution is required"),
  location: z.string().optional(),
  start_date: z.string().or(z.literal("")),
  end_date: z.string().or(z.literal("")),
  gpa: z.string().optional(),
  coursework: z.string().optional(),
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

interface EducationFormProps {
  onDirtyChange?: (isDirty: boolean, saveFn: () => Promise<boolean>) => void
}

export function EducationForm({ onDirtyChange }: EducationFormProps) {
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

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty, isValid },
  } = useForm<FormData>({
  })

  const formActive = isAdding || editingId !== null

  const handleCancel = useCallback(() => {
    reset()
    setEditingId(null)
    setIsAdding(false)
  }, [reset])

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
      try {
        localStorage.removeItem("resumer_draft_education")
      } catch {}
      queryClient.invalidateQueries({ queryKey: ["education"] })
      handleCancel()
    },
  })
  const performSave = useCallback(async (): Promise<boolean> => {
    if (!formActive) return true
    if (!isDirty) {
      handleCancel()
      return true
    }
    return new Promise<boolean>((resolve) => {
      handleSubmit(
        async (data) => {
          try {
            await saveMutation.mutateAsync(data)
            resolve(true)
          } catch {
            resolve(false)
          }
        },
        () => {
          resolve(false)
        }
      )()
    })
  }, [formActive, isDirty, handleCancel, handleSubmit, saveMutation])

  useEffect(() => {
    if (onDirtyChange) {
      onDirtyChange(formActive && isDirty, performSave)
    }
  }, [formActive, isDirty, performSave, onDirtyChange])

  // LocalStorage draft sync + 5-second inactivity DB auto-save
  const formValues = watch()
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!formActive || !isDirty) return

    try {
      localStorage.setItem("resumer_draft_education", JSON.stringify(formValues))
    } catch {}

    clearTimeout(debounceTimerRef.current!)

    debounceTimerRef.current = setTimeout(() => {
      if (formActive && isDirty && isValid && !saveMutation.isPending) {
        performSave()
      }
    }, 5000)

    return () => {
      clearTimeout(debounceTimerRef.current!)
    }
  }, [formValues, formActive, isDirty, isValid, saveMutation.isPending, performSave])
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

  let status: SaveStatus = "saved"
  if (saveMutation.isPending) status = "saving"
  else if (saveMutation.isError) status = "error"
  else if (isDirty) status = "unsaved"

  const renderForm = () => (
    <form
      onSubmit={handleSubmit((data) => saveMutation.mutate(data))}
      className="space-y-4 border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 p-4 pixel-enter"
    >
      <div className="mb-1 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-700 pb-2">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-black dark:text-zinc-100 uppercase tracking-tight">
            {editingId ? "Edit Education" : "Add Education"}
          </h3>
          <SaveStatusBadge status={status} onSaveNow={isDirty ? performSave : undefined} />
        </div>
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
          <Label htmlFor="degree">Degree / Field of Study</Label>
          <Input id="degree" placeholder="e.g. B.S. in Computer Science" {...register("degree")} />
          {errors.degree && (
            <p className="text-red-600 dark:text-red-400 text-xs font-bold">
              {errors.degree.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="institution">School / Institution</Label>
          <Input
            id="institution"
            placeholder="e.g. Stanford University"
            {...register("institution")}
          />
          {errors.institution && (
            <p className="text-red-600 dark:text-red-400 text-xs font-bold">
              {errors.institution.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="location">Location</Label>
          <Input id="location" placeholder="e.g. Stanford, CA" {...register("location")} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="gpa">GPA</Label>
          <Input id="gpa" placeholder="e.g. 3.8/4.0" {...register("gpa")} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="start_date">Start Date</Label>
          <Input id="start_date" type="date" {...register("start_date")} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="end_date">End Date (leave blank for Present)</Label>
          <Input id="end_date" type="date" {...register("end_date")} />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="coursework">Relevant Coursework (comma separated)</Label>
          <Input
            id="coursework"
            placeholder="Data Structures, Algorithms, Web Development"
            {...register("coursework")}
          />
        </div>
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
  )

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <div className="flex gap-2">
          <span className="loading-dot bg-[#ff4e26]" />
          <span className="loading-dot bg-yellow-400" />
          <span className="loading-dot bg-[#ff4e26]" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 pixel-enter">
      {!isAdding && (
        <div className="flex items-center justify-between gap-3 border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 p-3">
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 sm:text-sm">
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
            <Plus size={16} /> Add Education
          </Button>
        </div>
      )}

      {isAdding && !editingId && renderForm()}

      <div className="space-y-3">
        {educationList.map((edu) => (
          <div key={edu.id} className="space-y-3">
            <div className="flex items-start justify-between gap-3 border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 transition-colors hover:border-zinc-400 dark:hover:border-zinc-500 md:p-4">
              <div className="min-w-0 space-y-1.5">
                <h4 className="text-base font-extrabold uppercase tracking-tight text-black dark:text-zinc-100">
                  {edu.degree}
                </h4>
                <p className="text-xs font-bold uppercase tracking-wide text-zinc-700 dark:text-zinc-300 sm:text-sm">
                  {edu.institution} —{" "}
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {edu.location || "Location N/A"}
                  </span>
                </p>
                <p className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase">
                  {edu.start_date || "Start N/A"} to {edu.end_date || "Present"}
                </p>
                {edu.gpa && (
                  <p className="text-xs font-bold text-zinc-600 dark:text-zinc-400 mt-1 uppercase">
                    GPA: {edu.gpa}
                  </p>
                )}
                {edu.coursework && edu.coursework.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {edu.coursework.map((c: string) => (
                      <span
                        key={c}
                        className="border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 py-0.5 text-[10px] font-bold uppercase text-zinc-600 dark:text-zinc-300"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => startEdit(edu)}
                  className="border-transparent hover:border-black dark:hover:border-zinc-400"
                >
                  <Edit2 size={14} className="text-black dark:text-zinc-200" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => {
                    if (confirm("Are you sure?")) deleteMutation.mutate(edu.id)
                  }}
                  className="border-transparent hover:border-red-500 hover:text-red-500"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
            {editingId === edu.id && renderForm()}
          </div>
        ))}
      </div>
    </div>
  )
}
