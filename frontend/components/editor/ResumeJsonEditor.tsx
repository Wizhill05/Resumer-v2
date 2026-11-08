"use client"

import { useEffect, useRef, useState } from "react"
import { TailoredResumeSchema } from "@/lib/resume-schema"

type Props = {
  value: string
  onChange: (raw: string, parsed: Record<string, unknown> | null, error: string | null) => void
}

export function ResumeJsonEditor({ value, onChange }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = "auto"
    ta.style.height = ta.scrollHeight + "px"
  }, [value])

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const raw = e.target.value
    let parsed: Record<string, unknown> | null = null
    let err: string | null = null

    try {
      const json = JSON.parse(raw)
      const result = TailoredResumeSchema.safeParse(json)
      if (result.success) {
        parsed = result.data as Record<string, unknown>
      } else {
        err = result.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")
      }
    } catch (e2) {
      err = e2 instanceof Error ? e2.message : "Invalid JSON"
    }

    setLocalError(err)
    onChange(raw, parsed, err)
  }

  const isError = localError !== null
  const isEmpty = value.trim() === ""

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="px-3 py-1.5 border-b border-line bg-paper flex items-center gap-2 text-xs text-ink-muted">
        <span className="">JSON</span>
        {isError && !isEmpty && (
          <span className="text-red-500 truncate max-w-xs">{localError}</span>
        )}
        {!isError && !isEmpty && (
          <span className="text-green-600">valid</span>
        )}
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0 overflow-auto">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          spellCheck={false}
          className={`w-full min-h-full text-xs resize-none p-3 outline-none bg-paper dark:text-ink leading-relaxed ${
            isError && !isEmpty ? "border-l border-red-400" : "border-l border-transparent"
          }`}
          style={{ fontFamily: "'Fira Code', 'Cascadia Code', 'Menlo', monospace" }}
          aria-label="Résumé JSON editor"
        />
      </div>
    </div>
  )
}
