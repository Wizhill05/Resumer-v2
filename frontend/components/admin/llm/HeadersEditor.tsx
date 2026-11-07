"use client"

import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { validateHeader } from "./format"

export type HeaderRow = { id: number; key: string; value: string }

let rowSeq = 0
export const newHeaderRow = (key = "", value = ""): HeaderRow => ({ id: ++rowSeq, key, value })

export function headersToRows(headers: Record<string, string>): HeaderRow[] {
  return Object.entries(headers).map(([k, v]) => newHeaderRow(k, v))
}

export function rowsToHeaders(rows: HeaderRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows) if (r.key.trim()) out[r.key.trim()] = r.value
  return out
}

export function headerRowsError(rows: HeaderRow[]): string | null {
  const seen = new Set<string>()
  for (const r of rows) {
    const e = validateHeader(r.key, r.value)
    if (e) return e
    const k = r.key.trim().toLowerCase()
    if (k && seen.has(k)) return `Duplicate header "${r.key.trim()}"`
    seen.add(k)
  }
  return null
}

export function HeadersEditor({
  rows,
  onChange,
  max,
}: {
  rows: HeaderRow[]
  onChange: (rows: HeaderRow[]) => void
  max: number
}) {
  const update = (id: number, patch: Partial<HeaderRow>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const lowerKeys = rows.map((r) => r.key.trim().toLowerCase())

  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <p className="border border-dashed border-zinc-300 px-3 py-2.5 text-xs text-zinc-500 dark:border-zinc-700">
          No extra headers. Useful for gateways that need e.g. <code className="font-mono">HTTP-Referer</code>,{" "}
          <code className="font-mono">OpenAI-Organization</code> or a tenant id.
        </p>
      )}
      {rows.map((row, i) => {
        const dup = row.key.trim() && lowerKeys.indexOf(row.key.trim().toLowerCase()) !== i
        const err = validateHeader(row.key, row.value) ?? (dup ? "Duplicate header" : null)
        return (
          <div key={row.id}>
            <div className="flex items-start gap-2">
              <Input
                aria-label={`Header ${i + 1} name`}
                value={row.key}
                onChange={(e) => update(row.id, { key: e.target.value })}
                placeholder="X-Header-Name"
                spellCheck={false}
                autoComplete="off"
                aria-invalid={!!err}
                className={cn("w-[40%] font-mono text-xs", err && "border-red-400 dark:border-red-700")}
              />
              <Input
                aria-label={`Header ${i + 1} value`}
                value={row.value}
                onChange={(e) => update(row.id, { value: e.target.value })}
                placeholder="value"
                spellCheck={false}
                autoComplete="off"
                className="min-w-0 flex-1 font-mono text-xs"
              />
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remove header ${row.key || i + 1}`}
                onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
              >
                <X size={14} />
              </Button>
            </div>
            {err && <p className="mt-1 text-[11px] font-semibold text-red-600 dark:text-red-400">{err}</p>}
          </div>
        )
      })}
      <div className="flex items-center justify-between">
        <Button size="xs" variant="outline" disabled={rows.length >= max} onClick={() => onChange([...rows, newHeaderRow()])}>
          <Plus size={12} /> Add header
        </Button>
        <span className="font-mono text-[10px] text-zinc-400">
          {rows.length}/{max}
        </span>
      </div>
    </div>
  )
}
