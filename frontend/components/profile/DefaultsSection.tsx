"use client"

import { useEffect, useState } from "react"
import { ChevronDown, ChevronUp, Loader2, SlidersHorizontal } from "lucide-react"
import { CreativityModeSelector, type CreativityMode } from "@/components/generation/CreativityModeSelector"

type Defaults = {
  creativity_mode: CreativityMode
  preferred_projects: number | null
  preferred_experience: number | null
}

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
          onClick={() => onChange(Math.max(0, value - 1))}
          className="flex h-7 w-7 items-center justify-center border border-zinc-200 bg-white text-sm font-black text-zinc-700 transition-colors hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 cursor-pointer"
        >
          −
        </button>
        <span className="w-6 text-center text-sm font-extrabold">{value}</span>
        <button
          type="button"
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
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [mode, setMode] = useState<CreativityMode>("larp")
  const [projects, setProjects] = useState(2)
  const [experience, setExperience] = useState(2)

  useEffect(() => {
    if (!open || loading) return
    setLoading(true)
    fetch("/api/backend/profile/defaults")
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load defaults")
        const data: Defaults = await res.json()
        if (data.creativity_mode) setMode(data.creativity_mode)
        if (data.preferred_projects != null) setProjects(data.preferred_projects)
        if (data.preferred_experience != null) setExperience(data.preferred_experience)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch("/api/backend/profile/defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creativity_mode: mode,
          preferred_projects: projects,
          preferred_experience: experience,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || "Failed to save defaults")
      }
      const data: Defaults = await res.json()
      if (data.creativity_mode) setMode(data.creativity_mode)
      if (data.preferred_projects != null) setProjects(data.preferred_projects)
      if (data.preferred_experience != null) setExperience(data.preferred_experience)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <button
        type="button"
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
        <div className="space-y-4 border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Loader2 size={14} className="animate-spin" /> Loading defaults…
            </div>
          ) : (
            <>
              <CreativityModeSelector value={mode} onChange={(v) => { setMode(v); setSaved(false) }} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Stepper label="Default projects" value={projects} onChange={(v) => { setProjects(v); setSaved(false) }} />
                <Stepper label="Default experiences" value={experience} onChange={(v) => { setExperience(v); setSaved(false) }} />
              </div>
              <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                New generations start from these defaults. Changing projects/experiences on a single generation
                also updates the defaults; changing the mode on a single generation does not.
              </p>
              {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
              {saved && <p className="text-xs font-semibold text-emerald-600">Defaults saved.</p>}
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="border border-zinc-950 bg-zinc-950 px-4 py-1.5 text-xs font-bold text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:border-zinc-400 dark:bg-zinc-700 cursor-pointer"
              >
                {saving ? "Saving…" : "Save defaults"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
