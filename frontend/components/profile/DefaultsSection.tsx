"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { z } from "zod"
import { QueryError } from "./QueryError"
import { ChevronDown, ChevronUp, Loader2, SlidersHorizontal } from "lucide-react"
import { CreativityModeSelector } from "@/components/generation/CreativityModeSelector"

import { useProfileWork } from "./ProfileChanges"

const defaultsSchema = z.object({
  creativity_mode: z.enum(["proper", "larp", "super_larp"]),
  preferred_projects: z.number().nullable(),
  preferred_experience: z.number().nullable(),
})
type Defaults = z.infer<typeof defaultsSchema>

function Stepper({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">{label}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`Decrease ${label.toLowerCase()}`}
          disabled={value === 0}
          onClick={() => onChange(Math.max(0, value - 1))}
          className="flex h-7 w-7 items-center justify-center border border-zinc-200 bg-white text-sm font-black text-zinc-700 transition-colors hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 cursor-pointer"
        >
          −
        </button>
        <span className="w-6 text-center text-sm font-extrabold">{value}</span>
        <button
          type="button"
          aria-label={`Increase ${label.toLowerCase()}`}
          disabled={value === 5}
          onClick={() => onChange(Math.min(5, value + 1))}
          className="flex h-7 w-7 items-center justify-center border border-zinc-200 bg-white text-sm font-black text-zinc-700 transition-colors hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 cursor-pointer"
        >
          +
        </button>
      </div>
    </div>
  )
}

export function DefaultsSection() {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Defaults | null>(null)
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["profile-defaults"], enabled: open,
    queryFn: async () => {
      const response = await fetch("/api/backend/profile/defaults")
      if (!response.ok) throw new Error("Could not load defaults")
      const value: unknown = await response.json()
      return defaultsSchema.parse(value)
    },
  })
  const current = draft ?? data
  const mode = current?.creativity_mode ?? "larp"
  const projects = current?.preferred_projects ?? 2
  const experience = current?.preferred_experience ?? 2
  const save = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/backend/profile/defaults", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creativity_mode: mode, preferred_projects: projects, preferred_experience: experience }),
      })
      if (!response.ok) throw new Error("Could not save defaults. Please try again.")
      const value: unknown = await response.json()
      return defaultsSchema.parse(value)
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["profile-defaults"], updated)
      setDraft(null)
    },
  })
  const update = (value: Partial<Defaults>) => {
    save.reset()
    setDraft({ creativity_mode: mode, preferred_projects: projects, preferred_experience: experience, ...value })
  }
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(data)
  useProfileWork("defaults", dirty, save.isPending)

  return (
    <div className="border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="profile-defaults"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left cursor-pointer"
      >
        <span className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-200">
          <SlidersHorizontal size={14} className="text-[#ff4e26]" />
          Defaults
        </span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <fieldset id="profile-defaults" disabled={save.isPending} className="space-y-4 border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Loader2 size={14} className="animate-spin" /> Loading defaults…
            </div>
          ) : isError ? <QueryError message="Could not load defaults. Please try again." onRetry={() => { void refetch() }} /> : (
            <>
              <CreativityModeSelector value={mode} onChange={(v) => update({ creativity_mode: v })} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Stepper label="Default projects" value={projects} onChange={(v) => update({ preferred_projects: v })} />
                <Stepper label="Default experiences" value={experience} onChange={(v) => update({ preferred_experience: v })} />
              </div>
              <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                New generations start from these defaults. Changing projects/experiences on a single generation
                also updates the defaults; changing the mode on a single generation does not.
              </p>
              {save.isError && <p role="alert" className="text-xs font-semibold text-red-600 dark:text-red-400">{save.error.message}</p>}
              {save.isSuccess && <p className="text-xs font-semibold text-emerald-600">Defaults saved.</p>}
              <button
                type="button"
                onClick={() => save.mutate()}
                disabled={save.isPending || !dirty}
                className="border border-zinc-950 bg-zinc-950 px-4 py-1.5 text-xs font-bold text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:border-zinc-400 dark:bg-zinc-700 cursor-pointer"
              >
                {save.isPending ? "Saving…" : "Save defaults"}
              </button>
            </>
          )}
        </fieldset>
      )}
    </div>
  )
}
