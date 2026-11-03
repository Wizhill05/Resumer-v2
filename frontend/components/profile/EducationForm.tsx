"use client"

import { ProfileDialog } from "./ProfileDialog"
import { QueryError } from "./QueryError"
import { useState, useCallback, useEffect } from "react"
import { useProfileDraft } from "./useProfileDraft"
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

const draftSchema = schema.extend({ degree: z.string(), institution: z.string() })

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
  onDirtyChange?: (isDirty: boolean, saveFn: () => Promise<boolean>, busy?: boolean, discardDraft?: () => void) => void
}

export function EducationForm({ onDirtyChange }: EducationFormProps) {
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const activeRecordId = editingId

  const { data: educationList = [], isLoading, isError, refetch } = useQuery<EducationItem[]>({
    queryKey: ["education"],
    queryFn: async () => {
      const res = await fetch("/api/backend/profile/education")
      if (!res.ok) throw new Error("Failed to load education entries")
      return res.json()
    },
  })

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
  })
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = form


  const formActive = isAdding || editingId !== null

  const { clear: clearDraft, notice: draftNotice } = useProfileDraft({ kind: "education", recordId: editingId, active: formActive, form, schema: draftSchema })

  const handleCancel = useCallback(() => {
    clearDraft()
    reset()
    setEditingId(null)
    setIsAdding(false)
  }, [reset, clearDraft])

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

      const url = activeRecordId
        ? `/api/backend/profile/education/${activeRecordId}`
        : "/api/backend/profile/education"
      const method = activeRecordId ? "PUT" : "POST"

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
      onDirtyChange(formActive && isDirty, performSave, saveMutation.isPending, clearDraft)
    }
  }, [formActive, isDirty, performSave, onDirtyChange, saveMutation.isPending, clearDraft])

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
    saveMutation.reset()
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

  const requestClose = () => {
    if (saveMutation.isPending) return
    if (!isDirty || window.confirm("Discard your unsaved changes?")) handleCancel()
  }

  const renderForm = () => (
    <ProfileDialog label={activeRecordId ? "Edit education" : "Add education"} busy={saveMutation.isPending} onRequestClose={requestClose}>
      <form
        onSubmit={handleSubmit((data) => {
          saveMutation.mutate(data)
        })}
        className="profile-entry-form space-y-4"
      >
        <div className="mb-1 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-700 pb-2">
          <div className="flex items-center gap-3">
            <h3 className="font-extrabold text-black dark:text-zinc-100 uppercase tracking-tight text-sm md:text-base">
              {activeRecordId ? "Edit Education" : "Add Education"}
            </h3>
            <SaveStatusBadge status={!activeRecordId && !isDirty && !saveMutation.isError ? "draft" : status} onSaveNow={isDirty ? () => performSave() : undefined} />
          </div>
          <Button
            type="button"
            variant="ghost"
            aria-label="Close editor"
            size="sm"
            onClick={requestClose}
            className="h-9 w-9 p-0 border-transparent text-zinc-500 hover:text-black dark:hover:text-white"
          >
            <X size={18} />
          </Button>
        </div>

        {draftNotice}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="degree">Degree / Field of Study</Label>
            <Input id="degree" placeholder="e.g. B.S. in Computer Science" aria-invalid={!!errors.degree} aria-describedby={errors.degree ? "degree-error" : undefined} {...register("degree")} />
            {errors.degree && (
              <p id="degree-error" role="alert" className="text-red-600 dark:text-red-400 text-xs font-bold">
                {errors.degree.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="institution">School / Institution</Label>
            <Input
              id="institution"
              placeholder="e.g. Stanford University"
              aria-invalid={!!errors.institution} aria-describedby={errors.institution ? "institution-error" : undefined} {...register("institution")}
            />
            {errors.institution && (
              <p id="institution-error" role="alert" className="text-red-600 dark:text-red-400 text-xs font-bold">
                {errors.institution.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="location">Location</Label>
            <Input id="location" placeholder="e.g. Stanford, CA" {...register("location")} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gpa">GPA</Label>
            <Input id="gpa" placeholder="e.g. 3.8/4.0" {...register("gpa")} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="start_date">Start Date</Label>
            <Input id="start_date" type="date" {...register("start_date")} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="end_date">End Date (leave blank for Present)</Label>
            <Input id="end_date" type="date" {...register("end_date")} />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="coursework">Relevant Coursework (comma separated)</Label>
            <Input
              id="coursework"
              placeholder="Data Structures, Algorithms, Web Development"
              {...register("coursework")}
            />
          </div>
        </div>

        <div className="flex gap-3 border-t border-zinc-200 dark:border-zinc-700 pt-3">
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
  )

  if (isError) return <QueryError message="Could not load education. Your entries have not been removed." onRetry={() => { void refetch() }} />

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
    <div className="space-y-3 pixel-enter md:space-y-4">
      {deleteMutation.isPending && <p role="status" className="text-sm">Deleting entry...</p>}
      {deleteMutation.isError && <QueryError message="Could not delete the entry. Please try deleting it again." onRetry={() => { if (deleteMutation.variables) deleteMutation.mutate(deleteMutation.variables) }} />}

      {(
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 pb-2.5 dark:border-zinc-800 md:border md:border-zinc-200 md:bg-zinc-50 md:p-3 md:dark:border-zinc-700 md:dark:bg-zinc-900/50">
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 sm:text-sm">
            {educationList.length} education entries
          </h3>
          <Button
            onClick={() => {
              saveMutation.reset()
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

      <div className="divide-y divide-zinc-200 dark:divide-zinc-800 md:divide-y-0 md:space-y-3">
        {educationList.map((edu) => (
          <div key={edu.id} className="py-2.5 md:py-0">
            <div className="flex items-start justify-between gap-3 rounded-none border-0 bg-transparent p-1 transition-colors md:border md:border-zinc-200 md:bg-white md:p-4 md:hover:border-zinc-400 md:dark:border-zinc-700 md:dark:bg-zinc-900 md:dark:hover:border-zinc-500">
              <div className="min-w-0 space-y-1">
                <h4 className="text-sm font-extrabold uppercase tracking-tight text-black dark:text-zinc-100 md:text-base">
                  {edu.degree}
                </h4>
                <p className="text-xs font-bold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                  {edu.institution} &bull;{" "}
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {edu.location || "Location N/A"}
                  </span>
                </p>
                <p className="text-[11px] font-bold text-zinc-400 dark:text-zinc-500 uppercase">
                  {edu.start_date || "Start N/A"} &rarr; {edu.end_date || "Present"}
                </p>
                {edu.gpa && (
                  <p className="text-xs font-bold text-zinc-600 dark:text-zinc-400 mt-1 uppercase">
                    GPA: {edu.gpa}
                  </p>
                )}
                {edu.coursework && edu.coursework.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {edu.coursework.map((c: string) => (
                      <span
                        key={c}
                        className="border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-1.5 py-0.5 text-[9px] font-bold uppercase text-zinc-600 dark:text-zinc-300"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => startEdit(edu)}
                  className="h-9 w-9 p-0 border-transparent hover:border-black dark:hover:border-zinc-400"
                  title="Edit entry"
                >
                  <Edit2 size={15} className="text-zinc-700 dark:text-zinc-200" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => {
                    if (confirm("Delete this entry? This cannot be undone.")) deleteMutation.mutate(edu.id)
                  }}
                  disabled={deleteMutation.isPending}
                  className="h-9 w-9 p-0 border-transparent hover:border-red-500 hover:text-red-500"
                  title="Delete entry"
                >
                  <Trash2 size={15} />
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
