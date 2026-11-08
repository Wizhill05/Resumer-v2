"use client"

import { useEffect, useRef, useState, type PointerEvent } from "react"
import { cn } from "@/lib/utils"
import { formatCompact, formatNumber } from "./shared"
import { useViz } from "./viz"

export type ChartSeries = { key: string; label: string; values: number[]; color: string }

const PAD = { top: 10, right: 12, bottom: 24, left: 36 }

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(Math.floor(el.getBoundingClientRect().width))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

function niceMax(max: number): number {
  if (max <= 4) return 4
  const pow = 10 ** Math.floor(Math.log10(max))
  const n = max / pow
  const nice = [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10].find((step) => n <= step) ?? 10
  return nice * pow
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" })
}

function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
}

function tickIndexes(count: number, width: number): number[] {
  const target = Math.max(2, Math.min(count, Math.floor(width / 120)))
  if (count <= 1) return [0]
  const picks = new Set<number>()
  for (let i = 0; i < target; i++) picks.add(Math.round((i * (count - 1)) / (target - 1)))
  return [...picks]
}

export function Legend({ series }: { series: ChartSeries[] }) {
  const c = useViz()
  if (series.length < 2) return null
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-600 dark:text-zinc-300">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5" style={{ background: c(s.color) }} />
          {s.label}
        </li>
      ))}
    </ul>
  )
}

function Tooltip({
  x,
  width,
  title,
  rows,
}: {
  x: number
  width: number
  title: string
  rows: { label: string; value: number; color: string }[]
}) {
  const flip = x > width / 2
  const c = useViz()
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 min-w-32 border border-zinc-300 bg-white px-2.5 py-2 text-[11px] shadow-md dark:border-zinc-600 dark:bg-zinc-900"
      style={flip ? { right: width - x + 10 } : { left: x + 10 }}
    >
      <p className="mb-1 font-bold text-black dark:text-white">{title}</p>
      {rows.map((row) => (
        <p key={row.label} className="flex items-center justify-between gap-4 text-zinc-600 dark:text-zinc-300">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-2 w-2" style={{ background: c(row.color) }} />
            {row.label}
          </span>
          <span className="font-mono font-bold text-black dark:text-white">{formatNumber(row.value)}</span>
        </p>
      ))}
    </div>
  )
}

function DataTable({ dates, series, caption }: { dates: string[]; series: ChartSeries[]; caption: string }) {
  return (
    <div className="sr-only">
    <table>
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th>Date</th>
          {series.map((s) => (
            <th key={s.key}>{s.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {dates.map((date, i) => (
          <tr key={date}>
            <td>{date}</td>
            {series.map((s) => (
              <td key={s.key}>{s.values[i]}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  )
}

function Axes({
  width,
  height,
  max,
  dates,
  ticks,
  xAt,
}: {
  width: number
  height: number
  max: number
  dates: string[]
  ticks: number[]
  xAt: (i: number) => number
}) {
  const inner = height - PAD.top - PAD.bottom
  const levels = [0, 0.5, 1]
  const c = useViz()
  return (
    <g fontSize="10" fill={c("var(--viz-axis)")}>
      {levels.map((level) => {
        const y = PAD.top + inner - inner * level
        return (
          <g key={level}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y} y2={y} stroke={c("var(--viz-grid)")} strokeWidth="1" strokeDasharray={level === 0 ? undefined : "3 4"} />
            <text x={PAD.left - 6} y={y + 3} textAnchor="end">
              {formatCompact(Math.round(max * level))}
            </text>
          </g>
        )
      })}
      {ticks.map((i, n) => (
        <text key={i} x={xAt(i)} y={height - 6} textAnchor={n === 0 ? "start" : n === ticks.length - 1 ? "end" : "middle"}>
          {shortDate(dates[i])}
        </text>
      ))}
    </g>
  )
}

/** Multi-series line chart with a crosshair that follows mouse and touch. */
export function LineChart({
  dates,
  series,
  height = 200,
  caption,
  area = false,
}: {
  dates: string[]
  series: ChartSeries[]
  height?: number
  caption: string
  area?: boolean
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const c = useViz()
  const count = dates.length
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)))
  const inner = height - PAD.top - PAD.bottom
  const plotW = Math.max(1, width - PAD.left - PAD.right)
  const xAt = (i: number) => PAD.left + (count <= 1 ? plotW / 2 : (i / (count - 1)) * plotW)
  const yAt = (v: number) => PAD.top + inner - (v / max) * inner

  const onMove = (event: PointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - rect.left) / rect.width
    setHover(Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1)))))
  }

  return (
    <div>
      <Legend series={series} />
      <div ref={ref} className="relative w-full select-none" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={caption} className="block touch-pan-y overflow-visible">
            <Axes width={width} height={height} max={max} dates={dates} ticks={tickIndexes(count, width)} xAt={xAt} />
            {series.map((s, index) => {
              const points = s.values.map((v, i) => `${xAt(i)},${yAt(v)}`).join(" ")
              return (
                <g key={s.key}>
                  {area && index === 0 && (
                    <polygon
                      points={`${xAt(0)},${yAt(0)} ${points} ${xAt(count - 1)},${yAt(0)}`}
                      fill={c(s.color)}
                      opacity="0.14"
                    />
                  )}
                  <polyline points={points} fill="none" stroke={c(s.color)} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                </g>
              )
            })}
            {hover !== null && (
              <g>
                <line x1={xAt(hover)} x2={xAt(hover)} y1={PAD.top} y2={PAD.top + inner} stroke={c("var(--viz-axis)")} strokeWidth="1" />
                {series.map((s) => (
                  <circle key={s.key} cx={xAt(hover)} cy={yAt(s.values[hover])} r="4" fill={c(s.color)} strokeWidth="2" className="stroke-white dark:stroke-[#242427]" />
                ))}
              </g>
            )}
            <rect
              x={PAD.left}
              y={0}
              width={plotW}
              height={height}
              fill="transparent"
              onPointerDown={onMove}
              onPointerMove={onMove}
              onPointerLeave={(event) => event.pointerType === "mouse" && setHover(null)}
            />
          </svg>
        )}
        {hover !== null && width > 0 && (
          <Tooltip
            x={xAt(hover)}
            width={width}
            title={longDate(dates[hover])}
            rows={series.map((s) => ({ label: s.label, value: s.values[hover], color: s.color }))}
          />
        )}
      </div>
      <DataTable dates={dates} series={series} caption={caption} />
    </div>
  )
}

/** Stacked daily columns. Segments keep a 2px gap and only the top end is rounded. */
export function StackedBars({
  dates,
  series,
  height = 180,
  caption,
}: {
  dates: string[]
  series: ChartSeries[]
  height?: number
  caption: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const c = useViz()
  const count = dates.length
  const totals = dates.map((_, i) => series.reduce((sum, s) => sum + s.values[i], 0))
  const max = niceMax(Math.max(1, ...totals))
  const inner = height - PAD.top - PAD.bottom
  const plotW = Math.max(1, width - PAD.left - PAD.right)
  const slot = plotW / Math.max(1, count)
  const barW = Math.max(2, Math.min(28, slot - 2))
  const xAt = (i: number) => PAD.left + slot * i + slot / 2
  const scale = inner / max

  const onMove = (event: PointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - rect.left) / rect.width
    setHover(Math.max(0, Math.min(count - 1, Math.floor(ratio * count))))
  }

  return (
    <div>
      <Legend series={series} />
      <div ref={ref} className="relative w-full select-none" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={caption} className="block touch-pan-y">
            <Axes width={width} height={height} max={max} dates={dates} ticks={tickIndexes(count, width)} xAt={xAt} />
            {dates.map((date, i) => {
              let cursor = PAD.top + inner
              return (
                <g key={date} opacity={hover === null || hover === i ? 1 : 0.55}>
                  {series.map((s) => {
                    const h = s.values[i] * scale
                    if (h <= 0) return null
                    const drawn = Math.max(1, h - 2)
                    cursor -= h
                    return <rect key={s.key} x={xAt(i) - barW / 2} y={cursor + 2} width={barW} height={drawn} fill={c(s.color)} rx={Math.min(3, drawn / 2)} />
                  })}
                </g>
              )
            })}
            <rect
              x={PAD.left}
              y={0}
              width={plotW}
              height={height}
              fill="transparent"
              onPointerDown={onMove}
              onPointerMove={onMove}
              onPointerLeave={(event) => event.pointerType === "mouse" && setHover(null)}
            />
          </svg>
        )}
        {hover !== null && width > 0 && (
          <Tooltip
            x={xAt(hover)}
            width={width}
            title={longDate(dates[hover])}
            rows={[
              ...series.map((s) => ({ label: s.label, value: s.values[hover], color: s.color })),
              ...(series.length > 1 ? [{ label: "Total", value: totals[hover], color: "var(--viz-axis)" }] : []),
            ]}
          />
        )}
      </div>
      <DataTable dates={dates} series={series} caption={caption} />
    </div>
  )
}

export function Sparkline({ values, color = "var(--viz-1)", label }: { values: number[]; color?: string; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const c = useViz()
  const height = 28
  const max = Math.max(1, ...values)
  const x = (i: number) => (values.length <= 1 ? width / 2 : (i / (values.length - 1)) * width)
  const y = (v: number) => height - 2 - (v / max) * (height - 4)
  return (
    <div ref={ref} className="h-7 w-full" aria-hidden="true" title={label}>
      {width > 0 && values.length > 1 && (
        <svg width={width} height={height} className="block overflow-visible">
          <polyline points={values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke={c(color)} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      )}
    </div>
  )
}

export type RankedItem = { label: string; value: number; sub?: string }

/** Horizontal ranked bars, plain HTML so labels wrap and truncate like text. */
export function RankedBars({ items, color = "var(--viz-1)", empty = "No data in this window." }: { items: RankedItem[]; color?: string; empty?: string }) {
  const c = useViz()
  if (items.length === 0) return <p className="text-xs text-zinc-500">{empty}</p>
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <ol className="space-y-2.5">
      {items.map((item) => (
        <li key={item.label} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 truncate font-medium text-zinc-800 dark:text-zinc-200" title={item.label}>
              {item.label}
            </span>
            <span className="shrink-0 font-mono font-bold tabular-nums text-black dark:text-white">
              {formatNumber(item.value)}
              {item.sub && <span className="ml-1.5 font-normal text-zinc-500">{item.sub}</span>}
            </span>
          </div>
          <div className="mt-1 h-2 bg-zinc-100 dark:bg-zinc-800">
            <div className="h-full" style={{ width: `${Math.max(2, (item.value / max) * 100)}%`, background: c(color) }} />
          </div>
        </li>
      ))}
    </ol>
  )
}

export function Funnel({ steps }: { steps: { id: string; label: string; value: number }[] }) {
  const c = useViz()
  const top = Math.max(1, steps[0]?.value ?? 1)
  return (
    <ol className="space-y-3">
      {steps.map((step, i) => {
        const previous = i === 0 ? null : steps[i - 1].value
        const conversion = previous ? Math.round((step.value / previous) * 100) : null
        return (
          <li key={step.id}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-medium text-zinc-800 dark:text-zinc-200">{step.label}</span>
              <span className="shrink-0 font-mono tabular-nums">
                <span className="font-bold text-black dark:text-white">{formatNumber(step.value)}</span>
                {conversion !== null && <span className="ml-2 text-zinc-500">{Math.min(conversion, 999)}% of prev</span>}
              </span>
            </div>
            <div className="mt-1 h-3 bg-zinc-100 dark:bg-zinc-800">
              <div className={cn("h-full")} style={{ width: `${Math.max(step.value ? 2 : 0, (step.value / top) * 100)}%`, background: c("var(--viz-1)") }} />
            </div>
          </li>
        )
      })}
    </ol>
  )
}
