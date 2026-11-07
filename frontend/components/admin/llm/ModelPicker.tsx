"use client"

import { useId, useMemo, useRef, useState } from "react"
import { Check, CornerDownLeft, Search, SquarePen } from "lucide-react"
import { cn } from "@/lib/utils"
import type { LlmModelInfo, ModelKind } from "./types"
import { KIND_LABEL, formatContext } from "./format"

const KIND_ORDER: ModelKind[] = ["chat", "embedding", "audio", "image", "moderation", "other"]
const DEFAULT_KINDS: ModelKind[] = ["chat"]
const CAP_LABEL: Record<string, string> = { json_schema: "JSON", tools: "tools", vision: "vision", audio_input: "audio in" }

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase()
  const i = q ? text.toLowerCase().indexOf(q) : -1
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-[#ff4e26]/25 text-inherit dark:bg-[#ff4e26]/35">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

export function ModelPicker({
  models,
  value,
  onChange,
  defaultKinds = DEFAULT_KINDS,
  label = "Model",
  autoFocus,
  className,
  listClassName = "max-h-72",
}: {
  models: LlmModelInfo[]
  value: string | null
  onChange: (id: string) => void
  defaultKinds?: ModelKind[]
  label?: string
  autoFocus?: boolean
  className?: string
  listClassName?: string
}) {
  const uid = useId()
  const listRef = useRef<HTMLUListElement>(null)
  const [query, setQuery] = useState("")
  const kindCounts = useMemo(() => {
    const c = new Map<ModelKind, number>()
    for (const m of models) c.set(m.kind, (c.get(m.kind) ?? 0) + 1)
    return c
  }, [models])
  const presentKinds = KIND_ORDER.filter((k) => kindCounts.has(k))
  // null = "use defaults" so a list that arrives after mount (probe) still gets sensible filters.
  const [kindOverride, setKindOverride] = useState<Set<ModelKind> | null>(null)
  const kinds = useMemo(() => {
    if (kindOverride) return kindOverride
    const wanted = defaultKinds.filter((k) => kindCounts.has(k))
    return new Set<ModelKind>(wanted.length ? wanted : KIND_ORDER.filter((k) => kindCounts.has(k)))
  }, [kindOverride, defaultKinds, kindCounts])
  const [active, setActive] = useState(0)

  const q = query.trim()
  const filtered = useMemo(() => {
    const needle = q.toLowerCase()
    return models.filter(
      (m) =>
        (kinds.has(m.kind) || presentKinds.length <= 1) &&
        (!needle || m.id.toLowerCase().includes(needle) || (m.owned_by ?? "").toLowerCase().includes(needle)),
    )
  }, [models, kinds, q, presentKinds.length])
  const showCustom = !!q && !models.some((m) => m.id === q)
  const optionCount = filtered.length + (showCustom ? 1 : 0)
  const activeIdx = Math.min(active, Math.max(0, optionCount - 1))
  const optionId = (i: number) => `${uid}-opt-${i}`
  const windowed = filtered.length > 500

  const pick = (i: number) => {
    if (i < filtered.length) onChange(filtered[i].id)
    else if (showCustom) onChange(q)
  }

  const moveTo = (i: number) => {
    setActive(i)
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>(`[data-idx="${i}"]`)?.scrollIntoView({ block: "nearest" })
    })
  }

  const toggleKind = (k: ModelKind) => {
    const next = new Set(kinds)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    setKindOverride(next)
    setActive(0)
  }

  return (
    <div className={cn("border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900", className)}>
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-800">
        <Search size={14} aria-hidden className="shrink-0 text-zinc-400" />
        <input
          role="combobox"
          aria-label={`${label}: search or type a model id`}
          aria-expanded
          aria-controls={`${uid}-list`}
          aria-autocomplete="list"
          aria-activedescendant={optionCount ? optionId(activeIdx) : undefined}
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault()
              if (optionCount) moveTo((activeIdx + 1) % optionCount)
            } else if (e.key === "ArrowUp") {
              e.preventDefault()
              if (optionCount) moveTo((activeIdx - 1 + optionCount) % optionCount)
            } else if (e.key === "Enter") {
              e.preventDefault()
              if (optionCount) pick(activeIdx)
            }
          }}
          placeholder={models.length ? `Search ${models.length} models or type an id` : "Type a model id"}
          spellCheck={false}
          autoComplete="off"
          className="h-10 min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:font-sans placeholder:text-zinc-400"
        />
        {models.length > 0 && (
          <span className="shrink-0 font-mono text-[10px] text-zinc-400" aria-live="polite">
            {filtered.length} of {models.length}
          </span>
        )}
      </div>

      {presentKinds.length > 1 && (
        <div className="flex flex-wrap gap-1.5 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800" role="group" aria-label="Filter by model type">
          {presentKinds.map((k) => {
            const on = kinds.has(k)
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => toggleKind(k)}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1 border px-2 py-0.5 text-[11px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-[#ff4e26]",
                  on
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-300 dark:bg-zinc-200 dark:text-zinc-900"
                    : "border-zinc-300 text-zinc-500 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-400",
                )}
              >
                {on && <Check size={11} aria-hidden />}
                {KIND_LABEL[k]}
                <span className="font-mono text-[10px] opacity-70">{kindCounts.get(k)}</span>
              </button>
            )
          })}
        </div>
      )}

      <ul id={`${uid}-list`} ref={listRef} role="listbox" aria-label={label} className={cn("overflow-y-auto overscroll-contain", listClassName)}>
        {models.length === 0 && !q && (
          <li className="px-3 py-6 text-center text-xs text-zinc-500">
            No model list available. Type the exact model id above, e.g. <code className="font-mono">gpt-4.1-mini</code>.
          </li>
        )}
        {models.length > 0 && filtered.length === 0 && !q && (
          <li className="px-3 py-6 text-center text-xs text-zinc-500">No models match the selected types.</li>
        )}
        {filtered.map((m, i) => {
          const selected = m.id === value
          const ctx = formatContext(m.context_length)
          return (
            <li
              key={m.id}
              id={optionId(i)}
              data-idx={i}
              role="option"
              aria-selected={selected}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(i)}
              onMouseMove={() => activeIdx !== i && setActive(i)}
              style={windowed ? { contentVisibility: "auto", containIntrinsicSize: "auto 44px" } : undefined}
              className={cn(
                "flex cursor-pointer items-center gap-3 border-l-[3px] px-3 py-2",
                i === activeIdx ? "bg-zinc-100 dark:bg-zinc-800" : "",
                selected ? "border-[#ff4e26]" : "border-transparent",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center border",
                  selected ? "border-[#ff4e26] bg-[#ff4e26] text-white" : "border-zinc-300 dark:border-zinc-600",
                )}
              >
                {selected && <Check size={11} strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[13px] font-semibold text-zinc-900 dark:text-zinc-100" title={m.id}>
                  <Highlight text={m.id} query={q} />
                </span>
                {(m.owned_by || m.kind !== "chat") && (
                  <span className="block truncate text-[11px] text-zinc-500">
                    {m.owned_by}
                    {m.owned_by && m.kind !== "chat" ? " · " : ""}
                    {m.kind !== "chat" ? KIND_LABEL[m.kind] : ""}
                  </span>
                )}
              </span>
              <span className="hidden shrink-0 items-center gap-1 sm:flex">
                {m.capabilities.map((c) => (
                  <span key={c} className="border border-zinc-200 px-1 font-mono text-[9px] uppercase text-zinc-500 dark:border-zinc-700">
                    {CAP_LABEL[c] ?? c}
                  </span>
                ))}
              </span>
              {ctx && <span className="w-10 shrink-0 text-right font-mono text-[11px] text-zinc-500">{ctx}</span>}
            </li>
          )
        })}
        {showCustom && (
          <li
            id={optionId(filtered.length)}
            data-idx={filtered.length}
            role="option"
            aria-selected={value === q}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(filtered.length)}
            onMouseMove={() => activeIdx !== filtered.length && setActive(filtered.length)}
            className={cn(
              "flex cursor-pointer items-center gap-3 border-t border-dashed border-zinc-300 px-3 py-2.5 dark:border-zinc-700",
              activeIdx === filtered.length && "bg-zinc-100 dark:bg-zinc-800",
            )}
          >
            <SquarePen size={14} aria-hidden className="shrink-0 text-[#ff4e26]" />
            <span className="min-w-0 flex-1 truncate text-xs">
              Use custom id <span className="font-mono font-bold">{q}</span>
            </span>
            <CornerDownLeft size={12} aria-hidden className="shrink-0 text-zinc-400" />
          </li>
        )}
      </ul>
    </div>
  )
}
