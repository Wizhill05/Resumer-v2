"use client"

import { useEffect, useState } from "react"

export type GuestRun = {
  id: string
  status: string
  job_title?: string | null
  company?: string | null
  error_message?: string | null
  created_at?: string | null
  expires_at?: string | null
  notify_email?: string | null
}

/** "loading" until the first response; "missing" when the run is gone (expired, other browser, claimed). */
export type GuestRunStatus = "loading" | "pending" | "in_progress" | "completed" | "failed" | "missing"

export type GuestRunState = {
  run: GuestRun | null
  status: GuestRunStatus
  percent: number
  stepLabel: string
  error: string | null
}

const NODE_PROGRESS: Record<string, number> = {
  job_analysis: 10,
  selection: 18,
  summary_skills: 26,
  experience_writer: 34,
  projects_writer: 42,
  extracurricular_writer: 50,
  assembly: 58,
  renderer: 68,
  orphan_repair: 76,
  content_reduction: 84,
  saver: 95,
}

const NODE_LABELS: Record<string, string> = {
  job_analysis: "Analyzing job post",
  selection: "Selecting content",
  summary_skills: "Writing summary & skills",
  experience_writer: "Writing experience",
  projects_writer: "Writing projects",
  extracurricular_writer: "Writing extracurriculars",
  assembly: "Assembling résumé",
  renderer: "Rendering PDF",
  orphan_repair: "Fixing layout issues",
  content_reduction: "Optimizing fit",
  saver: "Saving files",
}

const POLL_MS = 3000

export function isGuestRunActive(status: GuestRunStatus): boolean {
  return status === "loading" || status === "pending" || status === "in_progress"
}

function toStatus(raw: string | undefined): GuestRunStatus {
  return raw === "completed" || raw === "failed" || raw === "in_progress" ? raw : "pending"
}

const initialState = (): GuestRunState => ({
  run: null,
  status: "loading",
  percent: 5,
  stepLabel: "Starting",
  error: null,
})

/** Follows one guest generation: details, progress from its logs, and terminal status. */
export function useGuestRun(id: string | null): GuestRunState {
  const [state, setState] = useState<{ id: string | null } & GuestRunState>(() => ({ id, ...initialState() }))

  useEffect(() => {
    if (!id) return
    let alive = true
    let since = 0
    let timer: ReturnType<typeof setInterval> | null = null
    let finished = false

    const update = (patch: (prev: GuestRunState) => Partial<GuestRunState>) => {
      if (!alive) return
      setState((prev) => {
        const base = prev.id === id ? prev : { id, ...initialState() }
        return { ...base, ...patch(base) }
      })
    }
    const stop = () => {
      finished = true
      if (timer) clearInterval(timer)
      timer = null
    }

    const load = async () => {
      try {
        const res = await fetch(`/api/guest/generate/${id}`, { cache: "no-store" })
        const body = await res.json().catch(() => null)
        if (res.status === 401 || res.status === 404) {
          stop()
          update(() => ({ status: "missing", error: null }))
          return
        }
        if (!res.ok) throw new Error(typeof body?.detail === "string" ? body.detail : "Couldn't load this résumé")
        const run = body as GuestRun
        const status = toStatus(run.status)
        update((prev) => ({
          run,
          status,
          error: null,
          percent: status === "completed" ? 100 : prev.percent,
        }))
        if (status === "completed" || status === "failed") stop()
      } catch (err) {
        update(() => ({ error: err instanceof Error ? err.message : "Couldn't load this résumé" }))
      }
    }

    const poll = async () => {
      try {
        const res = await fetch(`/api/guest/generate/${id}/logs?since=${since}`, { cache: "no-store" })
        if (res.status === 401 || res.status === 404) {
          stop()
          update(() => ({ status: "missing" }))
          return
        }
        if (!res.ok) return
        const data = await res.json()
        let percent = 0
        let label: string | null = null
        for (const log of data.logs ?? []) {
          since = log.id
          if (log.node && NODE_PROGRESS[log.node]) percent = Math.max(percent, NODE_PROGRESS[log.node])
          if (log.node && NODE_LABELS[log.node]) label = NODE_LABELS[log.node]
        }
        const status = toStatus(data.status)
        update((prev) => ({
          status,
          percent: status === "completed" ? 100 : Math.max(prev.percent, percent),
          stepLabel: label ?? prev.stepLabel,
        }))
        // Terminal: fetch the final record (job title, error, expiry) once.
        if (status === "completed" || status === "failed") {
          stop()
          await load()
        }
      } catch {
        // Network blip: retry on the next tick.
      }
    }

    void load().then(() => {
      if (alive && !finished) {
        void poll()
        timer = setInterval(poll, POLL_MS)
      }
    })
    return () => {
      alive = false
      stop()
    }
  }, [id])

  if (!id) return { ...initialState(), status: "missing" }
  return state.id === id ? state : initialState()
}
