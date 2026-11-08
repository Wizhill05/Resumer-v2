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
      <span className="text-sm font-semibold text-ink">{label}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`Decrease ${label.toLowerCase()}`}
          disabled={value === 0}
          onClick={() => onChange(Math.max(0, value - 1))}
          className="flex h-7 w-7 items-center justify-center border border-line bg-paper text-sm font-bold text-ink transition-colors hover:border-ink/40 cursor-pointer rounded-md"
        >
          −
        </button>
        <span className="w-6 text-center text-sm font-bold">{value}</span>
        <button
          type="button"
          aria-label={`Increase ${label.toLowerCase()}`}
          disabled={value === 5}
          onClick={() => onChange(Math.min(5, value + 1))}
          className="flex h-7 w-7 items-center justify-center border border-line bg-paper text-sm font-bold text-ink transition-colors hover:border-ink/40 cursor-pointer rounded-md"
        >
          +
        </button>
      </div>
    </div>
  )
}

export function DefaultsSection({ open: openProp, onOpenChange, hideTrigger = false }: { open?: boolean; onOpenChange?: (open: boolean) => void; hideTrigger?: boolean } = {}) {
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const setOpen = (value: boolean) => { setOpenState(value); onOpenChange?.(value) }
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
  const mode = current?.creativity_mode ?? "proper"
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

  if (hideTrigger && !open) return null

  return (
    <div className="soft-card">
      {hideTrigger ? (
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="flex items-center gap-2 text-base font-bold text-ink">
            <SlidersHorizontal size={16} className="text-ember" aria-hidden="true" />
            Generation defaults
          </h2>
          <button type="button" onClick={() => setOpen(false)} className="cursor-pointer text-xs font-semibold text-ink-muted hover:text-ink">
            Close
          </button>
        </div>
      ) : (
      <button
        type="button"
        aria-expanded={open}
        aria-controls="profile-defaults"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left cursor-pointer"
      >
        <span className="flex items-center gap-2 text-xs font-bold text-ink">
          <SlidersHorizontal size={14} className="text-[#ff4e26]" />
          Defaults
        </span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      )}

      {open && (
        <fieldset id="profile-defaults" disabled={save.isPending} className={`space-y-4 px-5 py-4 ${hideTrigger ? "" : "border-t border-line"}`}>
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-ink-muted">
              <Loader2 size={14} className="animate-spin" /> Loading defaults…
            </div>
          ) : isError ? <QueryError message="Could not load defaults. Please try again." onRetry={() => { void refetch() }} /> : (
            <>
              <CreativityModeSelector value={mode} onChange={(v) => update({ creativity_mode: v })} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Stepper label="Default projects" value={projects} onChange={(v) => update({ preferred_projects: v })} />
                <Stepper label="Default experiences" value={experience} onChange={(v) => update({ preferred_experience: v })} />
              </div>
              <p className="text-[11px] font-medium text-ink-muted">
                New generations start from these defaults. Changing projects/experiences on a single generation
                also updates the defaults; changing the mode on a single generation does not.
              </p>
              {save.isError && <p role="alert" className="text-xs font-semibold text-red-600 dark:text-red-400">{save.error.message}</p>}
              {save.isSuccess && <p className="text-xs font-semibold text-ink-soft">Defaults saved.</p>}
              <button
                type="button"
                onClick={() => save.mutate()}
                disabled={save.isPending || !dirty}
                className="cursor-pointer rounded-md border border-[#e03d16] bg-gradient-to-b from-[#ff6a45] to-[#ff4e26] px-4 py-2 text-xs font-semibold text-white transition-opacity disabled:opacity-50"
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
