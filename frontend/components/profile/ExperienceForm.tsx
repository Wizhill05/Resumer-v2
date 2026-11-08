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
import { Textarea } from "@/components/ui/textarea"
import { Loader2, Plus, Trash2, Edit2, X } from "lucide-react"
import { SaveStatusBadge, SaveStatus } from "./SaveStatusBadge"

const schema = z.object({
  role: z.string().min(1, "Role/Title is required"),
  organization: z.string().min(1, "Company/Organization is required"),
  location: z.string().optional(),
  start_date: z.string().or(z.literal("")),
  end_date: z.string().or(z.literal("")),
  bullet_points: z.string().optional(),
  sort_order: z.number().optional(),
})

const draftSchema = schema.extend({ role: z.string(), organization: z.string() })

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

interface ExperienceFormProps {
  onDirtyChange?: (isDirty: boolean, saveFn: () => Promise<boolean>, busy?: boolean, discardDraft?: () => void) => void
}

export function ExperienceForm({ onDirtyChange }: ExperienceFormProps) {
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const activeRecordId = editingId

  const { data: experiences = [], isLoading, isError, refetch } = useQuery<ExperienceItem[]>({
    queryKey: ["experiences"],
    queryFn: async () => {
      const res = await fetch("/api/backend/profile/experiences")
      if (!res.ok) throw new Error("Failed to load experiences")
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

  const { clear: clearDraft, notice: draftNotice } = useProfileDraft({ kind: "experience", recordId: editingId, active: formActive, form, schema: draftSchema })

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
        bullet_points: data.bullet_points
          ? data.bullet_points.split("\n").map((b) => b.trim()).filter(Boolean)
          : [],
      }

      const url = activeRecordId
        ? `/api/backend/profile/experiences/${activeRecordId}`
        : "/api/backend/profile/experiences"
      const method = activeRecordId ? "PUT" : "POST"

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
    saveMutation.reset()
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

  let status: SaveStatus = "saved"
  if (saveMutation.isPending) status = "saving"
  else if (saveMutation.isError) status = "error"
  else if (isDirty) status = "unsaved"

  const requestClose = () => {
    if (saveMutation.isPending) return
    if (!isDirty || window.confirm("Discard your unsaved changes?")) handleCancel()
  }

  const renderForm = () => (
    <ProfileDialog label={activeRecordId ? "Edit experience" : "Add experience"} busy={saveMutation.isPending} onRequestClose={requestClose}>
      <form
        onSubmit={handleSubmit((data) => {
          saveMutation.mutate(data)
        })}
        className="profile-entry-form space-y-4"
      >
        <div className="mb-1 flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-bold tracking-tight text-ink md:text-xl">
              {activeRecordId ? "Edit experience" : "Add experience"}
            </h3>
            <SaveStatusBadge status={!activeRecordId && !isDirty && !saveMutation.isError ? "draft" : status} onSaveNow={isDirty ? () => performSave() : undefined} />
          </div>
          <Button
            type="button"
            variant="ghost"
            aria-label="Close editor"
            size="sm"
            onClick={requestClose}
            className="h-9 w-9 p-0 border-transparent text-ink-muted hover:text-ink dark:hover:text-white"
          >
            <X size={18} />
          </Button>
        </div>

        {draftNotice}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="role">Role / Job Title</Label>
            <Input id="role" aria-invalid={!!errors.role} aria-describedby={errors.role ? "role-error" : undefined} {...register("role")} />
            {errors.role && (
              <p id="role-error" role="alert" className="text-red-600 dark:text-red-400 text-xs font-bold">
                {errors.role.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="organization">Company / Organization</Label>
            <Input id="organization" aria-invalid={!!errors.organization} aria-describedby={errors.organization ? "organization-error" : undefined} {...register("organization")} />
            {errors.organization && (
              <p id="organization-error" role="alert" className="text-red-600 dark:text-red-400 text-xs font-bold">
                {errors.organization.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="location">Location</Label>
            <Input id="location" placeholder="e.g. Remote, or New York, NY" {...register("location")} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="start_date">Start Date</Label>
            <Input id="start_date" type="date" {...register("start_date")} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="end_date">End Date (leave blank for Present)</Label>
            <Input id="end_date" type="date" {...register("end_date")} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="bullet_points">Numerical data and impact (one per line)</Label>
          <Textarea
            id="bullet_points"
            rows={4}
            placeholder="- Increased efficiency by 40% through automated reporting&#10;- Reduced API latency by 180ms across 12 services"
            {...register("bullet_points")}
          />
        </div>

        <div className="flex gap-3 border-t border-line pt-3">
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
  if (isError) return <QueryError message="Could not load experiences. Your entries have not been removed." onRetry={() => { void refetch() }} />

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <div className="flex gap-2">
          <span className="loading-dot bg-[#ff4e26]" />
          <span className="loading-dot bg-[#ffb199]" />
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
        <div className="flex items-center justify-between gap-3 pb-1">
          <h2 className="flex items-center gap-2.5 text-xl font-bold tracking-tight text-ink md:text-2xl">Experience<span className="rounded bg-ink/5 px-1.5 py-0.5 text-xs font-semibold text-ink-soft">{experiences.length}</span></h2>
          <Button
            onClick={() => {
              saveMutation.reset()
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
            <Plus size={16} /> Add Experience
          </Button>
        </div>
      )}

      {isAdding && !editingId && renderForm()}

      <div className="space-y-3">
        {experiences.map((exp) => (
          <div key={exp.id} className="">
            <div className="flex items-start justify-between gap-3 rounded-md border border-line bg-paper p-4 shadow-soft transition-colors hover:border-ember/40 md:px-6 md:py-5">
              <div className="min-w-0 space-y-1">
                <h4 className="text-base font-bold tracking-tight text-ink md:text-[17px]">
                  {exp.role}
                </h4>
                <p className="text-sm font-semibold text-ink">
                  {exp.organization} &bull;{" "}
                  <span className="text-ink-muted">
                    {exp.location || "Remote"}
                  </span>
                </p>
                <p className="inline-flex rounded bg-ink/5 px-1.5 py-0.5 text-xs font-medium text-ink-soft">
                  {exp.start_date || "Start N/A"} &rarr; {exp.end_date || "Present"}
                </p>
                {exp.bullet_points && exp.bullet_points.length > 0 && (
                  <ul className="mt-1.5 list-outside list-disc space-y-1 pl-4 text-[13px] leading-relaxed text-ink/85 marker:text-ember/60">
                    {exp.bullet_points.map((b: string, i: number) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => startEdit(exp)}
                  className="h-9 w-9 p-0 border-transparent hover:border-ink/40 dark:hover:border-ember/50"
                  title="Edit entry"
                >
                  <Edit2 size={15} className="text-ink" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => {
                    if (confirm("Delete this entry? This cannot be undone.")) deleteMutation.mutate(exp.id)
                  }}
                  disabled={deleteMutation.isPending}
                  className="h-9 w-9 p-0 border-transparent hover:border-red-500 hover:text-red-500"
                  title="Delete entry"
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            </div>
            {editingId === exp.id && renderForm()}
          </div>
        ))}
      </div>
    </div>
  )
}
