"use client"

import { useState, useCallback, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Loader2, Plus, Trash2, Edit2, X } from "lucide-react"
import { SaveStatusBadge, SaveStatus } from "./SaveStatusBadge"

const schema = z.object({
  title: z.string().min(1, "Title is required"),
  organization: z.string().optional(),
  description: z.string().optional(),
  start_date: z.string().or(z.literal("")),
  end_date: z.string().or(z.literal("")),
  bullet_points: z.string().optional(),
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

interface ExtracurricularFormProps {
  onDirtyChange?: (isDirty: boolean, saveFn: () => Promise<boolean>) => void
}

export function ExtracurricularForm({ onDirtyChange }: ExtracurricularFormProps) {
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

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty, isValid },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
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

  let status: SaveStatus = "saved"
  if (saveMutation.isPending) status = "saving"
  else if (saveMutation.isError) status = "error"
  else if (isDirty) status = "unsaved"

  const renderForm = () => (
    <form
      onSubmit={handleSubmit((data) => saveMutation.mutate(data))}
      onBlur={() => {
        if (isDirty && isValid && !saveMutation.isPending) {
          performSave()
        }
      }}
      className="space-y-4 border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 p-4 pixel-enter"
    >
      <div className="mb-1 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-700 pb-2">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-black dark:text-zinc-100 uppercase tracking-tight">
            {editingId ? "Edit Activity / Achievement" : "Add Activity / Achievement"}
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
          <Label htmlFor="title">Title / Award / Activity</Label>
          <Input
            id="title"
            placeholder="e.g. Hackathon Winner, Open Source Contributor"
            {...register("title")}
          />
          {errors.title && (
            <p className="text-red-600 dark:text-red-400 text-xs font-bold">
              {errors.title.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="organization">Organization / Host (optional)</Label>
          <Input id="organization" placeholder="e.g. MLH, IEEE" {...register("organization")} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="start_date">Start Date</Label>
          <Input id="start_date" type="date" {...register("start_date")} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="end_date">End Date</Label>
          <Input id="end_date" type="date" {...register("end_date")} />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="description">Short Description / Role</Label>
          <Input
            id="description"
            placeholder="e.g. Led a team of 4 to build a web application"
            {...register("description")}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="bullet_points">Key Achievements (one per line)</Label>
        <Textarea
          id="bullet_points"
          rows={4}
          placeholder="- Awarded 1st place out of 50 teams&#10;- Mentored 20+ junior developers"
          {...register("bullet_points")}
        />
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
            {extracurriculars.length} activities & achievements
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
            <Plus size={16} /> Add Activity
          </Button>
        </div>
      )}

      {isAdding && !editingId && renderForm()}

      <div className="space-y-3">
        {extracurriculars.map((ex) => (
          <div key={ex.id} className="space-y-3">
            <div className="flex items-start justify-between gap-3 border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 transition-colors hover:border-zinc-400 dark:hover:border-zinc-500 md:p-4">
              <div className="min-w-0 space-y-1.5">
                <h4 className="text-base font-extrabold uppercase tracking-tight text-black dark:text-zinc-100">
                  {ex.title}
                </h4>
                {ex.organization && (
                  <p className="text-xs font-bold uppercase tracking-wide text-zinc-700 dark:text-zinc-300 sm:text-sm">
                    {ex.organization}
                  </p>
                )}
                {(ex.start_date || ex.end_date) && (
                  <p className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase">
                    {ex.start_date || "Start N/A"} to {ex.end_date || "Present"}
                  </p>
                )}
                {ex.description && (
                  <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300 mt-1">
                    {ex.description}
                  </p>
                )}
                {ex.bullet_points && ex.bullet_points.length > 0 && (
                  <ul className="mt-2 list-inside list-disc space-y-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    {ex.bullet_points.map((b: string, i: number) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => startEdit(ex)}
                  className="border-transparent hover:border-black dark:hover:border-zinc-400"
                >
                  <Edit2 size={14} className="text-black dark:text-zinc-200" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => {
                    if (confirm("Are you sure?")) deleteMutation.mutate(ex.id)
                  }}
                  className="border-transparent hover:border-red-500 hover:text-red-500"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
            {editingId === ex.id && renderForm()}
          </div>
        ))}
      </div>
    </div>
  )
}
