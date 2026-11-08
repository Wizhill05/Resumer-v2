"use client"

import { useEffect, useState } from "react"
import { ArrowLeftRight, Check, FolderGit, Loader2, X, AlertCircle } from "lucide-react"

export type ProfileProject = {
  id: string
  name: string
  description?: string | null
  technologies?: string[] | null
  bullet_points?: string[] | null
  github_url?: string | null
  live_url?: string | null
}

type Props = {
  isOpen: boolean
  onClose: () => void
  targetProjectName: string
  activeProjectNames: string[]
  onConfirmReplace: (profileProjectId: string) => Promise<void>
  isReplacing: boolean
}

export function ReplaceProjectModal({
  isOpen,
  onClose,
  targetProjectName,
  activeProjectNames,
  onConfirmReplace,
  isReplacing,
}: Props) {
  const [projects, setProjects] = useState<ProfileProject[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) {
      setSelectedId(null)
      setError(null)
      return
    }

    let isMounted = true
    async function loadProjects() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch("/api/backend/profile/projects")
        if (!res.ok) {
          throw new Error("Failed to load profile projects")
        }
        const data = await res.json()
        if (isMounted) {
          setProjects(data || [])
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Failed to load projects")
        }
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadProjects()
    return () => {
      isMounted = false
    }
  }, [isOpen])

  if (!isOpen) return null

  const cleanActiveNames = activeProjectNames.map((n) => n.trim().toLowerCase())

  function isProjectActive(p: ProfileProject) {
    return cleanActiveNames.includes(p.name.trim().toLowerCase())
  }

  const availableCount = projects.filter((p) => !isProjectActive(p)).length

  async function handleConfirm() {
    if (!selectedId || isReplacing) return
    await onConfirmReplace(selectedId)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[rgb(35_10_4/38%)] dark:bg-black/60 backdrop-blur-xs">
      <div
        className="relative w-full max-w-lg max-h-[90vh] flex flex-col bg-paper border border-line rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-ink/5 flex items-center justify-center text-ink">
              <ArrowLeftRight size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-ink">
                Replace Project from Profile
              </h3>
              <p className="text-xs text-ink-muted">
                Replacing <span className="font-semibold text-ink">&ldquo;{targetProjectName || "Selected Project"}&rdquo;</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isReplacing}
            className="text-ink-faint hover:text-ink-muted dark:hover:text-ink p-1.5 rounded-md hover:bg-ink/5 dark:hover:bg-ink/[0.06] transition-colors disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-3">
          {loading && (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-ink-faint text-xs">
              <Loader2 className="animate-spin text-ink-muted" size={20} />
              <span>Loading profile projects...</span>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg text-xs text-red-600 dark:text-red-400 flex items-start gap-2">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && projects.length === 0 && (
            <div className="py-10 px-4 text-center space-y-2">
              <FolderGit size={28} className="mx-auto text-ink-faint" />
              <p className="text-xs font-semibold text-ink">
                No projects found in your profile
              </p>
              <p className="text-xs text-ink-muted max-w-sm mx-auto">
                Add your projects in the Profile tab first to swap them into your résumés anytime.
              </p>
            </div>
          )}

          {!loading && !error && projects.length > 0 && availableCount === 0 && (
            <div className="py-10 px-4 text-center space-y-2">
              <FolderGit size={28} className="mx-auto text-ink-faint" />
              <p className="text-xs font-semibold text-ink">
                All profile projects are already in this résumé
              </p>
              <p className="text-xs text-ink-muted max-w-sm mx-auto">
                Add more projects in the Profile section to replace existing entries.
              </p>
            </div>
          )}

          {!loading && !error && projects.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-medium text-ink-muted flex justify-between">
                <span>Select a replacement project:</span>
                <span>{availableCount} available</span>
              </div>

              {projects.map((project) => {
                const isActive = isProjectActive(project)
                const isSelected = selectedId === project.id

                return (
                  <button
                    key={project.id}
                    type="button"
                    disabled={isActive || isReplacing}
                    onClick={() => setSelectedId(project.id)}
                    className={`w-full text-left p-3 rounded-lg border transition-all text-xs flex items-start justify-between gap-3 ${
                      isActive
                        ? "bg-ink/[0.03] dark:bg-ink/[0.06] border-line opacity-60 cursor-not-allowed"
                        : isSelected
                        ? "bg-ink/5 border-line-strong ring-1 ring-line-strong dark:ring-line cursor-pointer"
                        : "bg-paper border-line hover:border-ember/50 cursor-pointer"
                    }`}
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-ink truncate">
                          {project.name}
                        </span>
                        {isActive && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-ink/10 text-ink-muted font-semibold shrink-0">
                            Active in résumé
                          </span>
                        )}
                      </div>

                      {project.description && (
                        <p className="text-[11px] text-ink-muted line-clamp-2">
                          {project.description}
                        </p>
                      )}

                      {project.technologies && project.technologies.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {project.technologies.slice(0, 5).map((tech, tIdx) => (
                            <span
                              key={tIdx}
                              className="text-[9px] px-1.5 py-0.5 rounded bg-ink/5 text-ink-muted border border-line"
                            >
                              {tech}
                            </span>
                          ))}
                          {project.technologies.length > 5 && (
                            <span className="text-[9px] text-ink-faint">
                              +{project.technologies.length - 5} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="shrink-0 mt-0.5">
                      <div
                        className={`h-4 w-4 rounded-full border flex items-center justify-center ${
                          isSelected
                            ? "border-ember/50 bg-ember-tint text-ember"
                            : "border-line"
                        }`}
                      >
                        {isSelected && <Check size={10} strokeWidth={3} />}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {isReplacing && (
            <div className="p-3 bg-ink/[0.03] border border-line rounded-lg flex items-center gap-2.5 text-xs text-ink">
              <Loader2 className="animate-spin shrink-0 text-ink" size={16} />
              <div className="space-y-0.5">
                <p className="font-semibold">Re-tailoring with AI...</p>
                <p className="text-[10px] text-ink-muted">
                  Rewriting project achievements & running WeasyPrint orphan repair.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 bg-ink/[0.03] border-t border-line">
          <button
            type="button"
            onClick={onClose}
            disabled={isReplacing}
            className="px-3.5 py-1.5 text-xs font-semibold text-ink-muted hover:bg-ink/[0.07] dark:hover:bg-ink/[0.06] rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!selectedId || isReplacing}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-paper bg-ink hover:opacity-90 rounded-lg transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
          >
            {isReplacing ? (
              <>
                <Loader2 className="animate-spin" size={13} />
                <span>Starting...</span>
              </>
            ) : (
              <>
                <ArrowLeftRight size={13} />
                <span>AI</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
