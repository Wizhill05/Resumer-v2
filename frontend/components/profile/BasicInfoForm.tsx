"use client"

import { useEffect, useCallback, useRef } from "react"
import { useProfileDraft } from "./useProfileDraft"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { QueryError } from "./QueryError"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Mail } from "lucide-react"
import { SaveStatusBadge, SaveStatus } from "./SaveStatusBadge"

export function normalizeUrl(input?: string | null): string {
  if (!input) return ""
  const trimmed = input.trim()
  if (!trimmed) return ""
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

const schema = z.object({
  full_name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email").or(z.literal("")),
  phone: z.string().optional(),
  location: z.string().optional(),
  linkedin_url: z.string().optional(),
  github_url: z.string().optional(),
  portfolio_url: z.string().optional(),
  subtitle: z.string().optional(),
  summary: z.string().optional(),
  skills: z.string().optional(),
  notify_on_completion: z.boolean().optional(),
})

const draftSchema = schema.extend({ full_name: z.string(), email: z.string() })

type FormData = z.infer<typeof schema>

interface BasicInfoFormProps {
  onDirtyChange?: (isDirty: boolean, saveFn: () => Promise<boolean>, busy?: boolean, discardDraft?: () => void) => void
}

export function BasicInfoForm({ onDirtyChange }: BasicInfoFormProps) {
  const queryClient = useQueryClient()
  const initialized = useRef(false)

  const { data: profile, isLoading, isError, refetch } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const res = await fetch("/api/backend/profile")
      if (!res.ok) throw new Error("Failed to load profile")
      return res.json()
    },
  })

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
  })
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isDirty },
  } = form


  const { clear: clearDraft, notice: draftNotice } = useProfileDraft({ kind: "basic", recordId: null, active: !isLoading && !!profile, form, schema: draftSchema })

  useEffect(() => {
    if (profile && !initialized.current) {
      reset({
          full_name: profile.full_name || "",
          email: profile.email || "",
          phone: profile.phone || "",
          location: profile.location || "",
          linkedin_url: profile.linkedin_url || "",
          github_url: profile.github_url || "",
          portfolio_url: profile.portfolio_url || "",
          subtitle: profile.subtitle || "",
          summary: profile.summary || "",
          skills: profile.skills ? profile.skills.join(", ") : "",
          notify_on_completion: profile.notify_on_completion ?? true,
        })
      initialized.current = true
    }
  }, [profile, reset])

  const mutation = useMutation({
    mutationFn: async (data: FormData) => {
      const skillsArray = data.skills
        ? data.skills.split(",").map((s) => s.trim()).filter(Boolean)
        : []

      const res = await fetch("/api/backend/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          linkedin_url: normalizeUrl(data.linkedin_url),
          github_url: normalizeUrl(data.github_url),
          portfolio_url: normalizeUrl(data.portfolio_url),
          skills: skillsArray,
        }),
      })
      if (!res.ok) throw new Error("Failed to update profile")
      return res.json()
    },
    onSuccess: (updated) => {
      clearDraft()
      queryClient.invalidateQueries({ queryKey: ["profile"] })
      // Re-reset form state to updated values so isDirty resets
      reset({
        full_name: updated.full_name || "",
        email: updated.email || "",
        phone: updated.phone || "",
        location: updated.location || "",
        linkedin_url: updated.linkedin_url || "",
        github_url: updated.github_url || "",
        portfolio_url: updated.portfolio_url || "",
        subtitle: updated.subtitle || "",
        summary: updated.summary || "",
        skills: updated.skills ? updated.skills.join(", ") : "",
        notify_on_completion: updated.notify_on_completion ?? true,
      })
    },
  })

  const performSave = useCallback(async (): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      handleSubmit(
        async (data) => {
          try {
            await mutation.mutateAsync(data)
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
  }, [handleSubmit, mutation])

  // Register dirty state & save handler with parent ProfileClient
  useEffect(() => {
    if (onDirtyChange) {
      onDirtyChange(isDirty, performSave, mutation.isPending, clearDraft)
    }
  }, [isDirty, performSave, onDirtyChange, mutation.isPending, clearDraft])

  // Save status badge status computation
  let status: SaveStatus = "saved"
  if (mutation.isPending) {
    status = "saving"
  } else if (mutation.isError) {
    status = "error"
  } else if (isDirty) {
    status = "unsaved"
  }

  if (isError) return <QueryError message="Could not load your profile. Please try again." onRetry={() => { void refetch() }} />

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
    <form
      onSubmit={(event) => { event.preventDefault(); void performSave() }}
      className="pixel-enter"
    >
      <fieldset disabled={mutation.isPending} className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold tracking-tight text-ink md:text-2xl">Basic info</h2>
        {status === "error" && (
          <SaveStatusBadge
            status={status}
            onSaveNow={isDirty ? performSave : undefined}
          />
        )}
      </div>

      {draftNotice}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="full_name">Full Name</Label>
          <Input id="full_name" aria-invalid={!!errors.full_name} aria-describedby={errors.full_name ? "full_name-error" : undefined} {...register("full_name")} />
          {errors.full_name && (
            <p id="full_name-error" role="alert" className="text-red-600 dark:text-red-400 text-xs font-bold">{errors.full_name.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="subtitle">Subtitle / Headline</Label>
          <Input
            id="subtitle"
            placeholder="e.g. Final Year Undergraduate"
            {...register("subtitle")}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" aria-invalid={!!errors.email} aria-describedby={errors.email ? "email-error" : undefined} {...register("email")} />
          {errors.email && (
            <p id="email-error" role="alert" className="text-red-600 dark:text-red-400 text-xs font-bold">{errors.email.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" {...register("phone")} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="location">Location</Label>
          <Input id="location" placeholder="e.g. San Francisco, CA" {...register("location")} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="linkedin_url">LinkedIn URL</Label>
          <Input id="linkedin_url" {...register("linkedin_url")} />
          {errors.linkedin_url && (
            <p className="text-red-600 text-xs font-bold">{errors.linkedin_url.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="github_url">GitHub URL</Label>
          <Input id="github_url" {...register("github_url")} />
          {errors.github_url && (
            <p className="text-red-600 text-xs font-bold">{errors.github_url.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="portfolio_url">Portfolio URL</Label>
          <Input id="portfolio_url" {...register("portfolio_url")} />
          {errors.portfolio_url && (
            <p className="text-red-600 text-xs font-bold">{errors.portfolio_url.message}</p>
          )}
        </div>

        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="skills">Skills (comma separated)</Label>
          <Input id="skills" placeholder="React, Node.js, Python" {...register("skills")} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="summary">Professional Summary</Label>
        <Textarea id="summary" rows={4} {...register("summary")} />
      </div>

      {/* Email Notification Default Toggle */}
      <div className="flex items-start justify-between gap-4 rounded-md border border-line bg-paper p-4 shadow-soft">
        <div className="space-y-1">
          <Label className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Mail size={14} className="text-ember" /> Email me when a résumé is ready
          </Label>
          <p className="text-xs font-medium text-ink-muted">
            Automatically send an email with the PDF attachment when a résumé generation completes.
          </p>
        </div>
        <Controller
          control={control}
          name="notify_on_completion"
          render={({ field }) => (
            <button
              type="button"
              role="switch"
              aria-label="Receive completion emails"
              aria-checked={field.value ?? true}
              onClick={() => {
                const newVal = !(field.value ?? true)
                field.onChange(newVal)
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                field.value ?? true ? "bg-[#ff4e26]" : "bg-ink/20"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                  field.value ?? true ? "translate-x-[1.375rem]" : "translate-x-0.5"
                }`}
              />
            </button>
          )}
        />
      </div>
      <div className="flex gap-3"><Button type="submit" disabled={mutation.isPending || !isDirty}>{mutation.isPending ? "Saving..." : "Save changes"}</Button></div>
      </fieldset>
    </form>
  )
}
