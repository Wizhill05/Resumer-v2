"use client"

import { useRef, useState, type PointerEvent, type KeyboardEvent } from "react"
import { GripVertical, Lock, User, ChevronUp, ChevronDown } from "lucide-react"
import { SECTION_METADATA, type SectionId } from "@/lib/template-layout"
import { SectionIcon } from "./SectionIcon"

type Props = {
  items: SectionId[]
  onChange: (order: SectionId[]) => void
  onHoverSection?: (id: SectionId | null) => void
  disabled?: boolean
  className?: string
}

type Drag = {
  id: SectionId
  startY: number
  offset: number
  from: number
  to: number
  step: number
  pointerId: number
  active: boolean
}

export function SectionOrderList({ items, onChange, onHoverSection, disabled = false, className = "" }: Props) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const rows = useRef(new Map<SectionId, HTMLDivElement>())
  const [grabbed, setGrabbed] = useState<SectionId | null>(null)
  const beforeGrab = useRef<SectionId[]>([])
  const [announcement, setAnnouncement] = useState("")

  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= items.length) return
    const next = [...items]
    const [id] = next.splice(from, 1)
    next.splice(to, 0, id)
    onChange(next)
    setAnnouncement(`${SECTION_METADATA[id].label} moved to position ${to + 1} of ${items.length}.`)
  }

  function start(e: PointerEvent<HTMLButtonElement>, id: SectionId, from: number) {
    if (disabled || e.button !== 0) return
    const rect = rows.current.get(id)?.getBoundingClientRect()
    if (!rect) return
    const next = { id, from, to: from, startY: e.clientY, offset: 0, step: rect.height + 8, pointerId: e.pointerId, active: false }
    dragRef.current = next
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function track(e: PointerEvent<HTMLButtonElement>) {
    const current = dragRef.current
    if (!current || current.pointerId !== e.pointerId) return
    const offset = e.clientY - current.startY
    if (!current.active && Math.abs(offset) < 6) return
    const scroll = e.currentTarget.closest<HTMLElement>("[data-section-scroll]")
    if (scroll) {
      const rect = scroll.getBoundingClientRect()
      const delta = e.clientY < rect.top + 40 ? -12 : e.clientY > rect.bottom - 40 ? 12 : 0
      if (delta) {
        const previous = scroll.scrollTop
        scroll.scrollTop += delta
        current.startY -= scroll.scrollTop - previous
      }
    }
    const next = { ...current, active: true, offset, to: Math.max(0, Math.min(items.length - 1, current.from + Math.round(offset / current.step))) }
    dragRef.current = next
    setDrag(next)
  }

  function finish(e: PointerEvent<HTMLButtonElement>, cancel = false) {
    const current = dragRef.current
    if (!current || current.pointerId !== e.pointerId) return
    dragRef.current = null
    setDrag(null)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (current.active && !cancel) move(current.from, current.to)
  }

  function keyDown(e: KeyboardEvent<HTMLButtonElement>, id: SectionId, index: number) {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault()
      if (grabbed) setGrabbed(null)
      else {
        beforeGrab.current = [...items]
        setGrabbed(id)
        setAnnouncement(`${SECTION_METADATA[id].label} picked up. Use arrow keys to move, Space to drop, or Escape to cancel.`)
      }
    } else if (grabbed === id && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault()
      move(index, index + (e.key === "ArrowUp" ? -1 : 1))
    } else if (grabbed && e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      onChange(beforeGrab.current)
      setGrabbed(null)
      setAnnouncement("Reordering canceled.")
    }
  }

  return (
    <div className={`select-none ${className}`}>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</div>
      <p id="reorder-instructions" className="sr-only">Press Space to pick up, arrow keys to move, Space to drop, or Escape to cancel. You can also use the move up and down buttons.</p>
      <div className="mb-4 flex items-center gap-3 px-3 py-3 text-ink-muted">
        <User size={20} aria-hidden="true" />
        <span className="flex-1 text-sm font-medium">Name & contact details</span>
        <Lock size={14} aria-hidden="true" />
        <span className="text-xs">Fixed</span>
      </div>
      <div role="list" aria-label="Resume section order" className="space-y-2">
        {items.map((id, index) => {
          const active = drag?.id === id || grabbed === id
          let translate = 0
          if (drag?.active) {
            if (drag.id === id) translate = drag.offset
            else if (drag.from < drag.to && index > drag.from && index <= drag.to) translate = -drag.step
            else if (drag.from > drag.to && index < drag.from && index >= drag.to) translate = drag.step
          }
          return (
            <div key={id} ref={(el) => { if (el) rows.current.set(id, el); else rows.current.delete(id) }}
              role="listitem" data-section-id={id}
              onMouseEnter={() => onHoverSection?.(id)} onMouseLeave={() => onHoverSection?.(null)}
              style={{ transform: `translateY(${translate}px)`, zIndex: active ? 20 : 0, transition: drag?.id === id ? "none" : undefined }}
              className={`relative touch-pan-y flex min-h-[72px] items-center gap-2 rounded-lg border bg-paper px-2.5 py-3 motion-safe:transition-transform motion-safe:duration-200 ${active ? "border-[#ff4e26] shadow-lg ring-2 ring-[#ff4e26]/15" : "border-line"}`}
            >
              <button type="button" data-drag-handle aria-label={`Reorder ${SECTION_METADATA[id].label}, position ${index + 1} of ${items.length}`}
                aria-describedby="reorder-instructions" disabled={disabled}
                onPointerDown={(e) => start(e, id, index)} onPointerMove={track}
                onPointerUp={(e) => finish(e)} onPointerCancel={(e) => finish(e, true)}
                onLostPointerCapture={(e) => finish(e, true)}
                onKeyDown={(e) => keyDown(e, id, index)}
                onBlur={() => setGrabbed(null)}
                className="touch-none flex h-11 w-8 shrink-0 items-center justify-center text-ink-faint cursor-grab active:cursor-grabbing rounded focus-visible:outline-2 focus-visible:outline-[#ff4e26]">
                <GripVertical size={18} aria-hidden="true" />
              </button>
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${active ? "bg-orange-50 text-[#ff4e26] dark:bg-orange-950/40" : "bg-ink/5 text-ink-muted"}`}><SectionIcon section={id} size={20} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold leading-tight text-ink">{SECTION_METADATA[id].label}</span>
                <span className="hidden lg:block mt-1 text-xs leading-snug text-ink-muted">{SECTION_METADATA[id].shortDescription}</span>
              </span>
              <div className="flex shrink-0 items-center">
                {(["up", "down"] as const).map((direction) => (
                  <button key={direction} type="button" aria-label={`Move ${SECTION_METADATA[id].label} ${direction}`}
                    disabled={disabled || (direction === "up" ? index === 0 : index === items.length - 1)}
                    onClick={(e) => {
                      move(index, index + (direction === "up" ? -1 : 1))
                      const button = e.currentTarget
                      requestAnimationFrame(() => {
                        if (button.disabled) rows.current.get(id)?.querySelector<HTMLButtonElement>("[data-drag-handle]")?.focus()
                        else button.focus()
                      })
                    }}
                    className="flex h-11 w-9 items-center justify-center rounded text-ink-muted hover:bg-ink/5 dark:hover:bg-ink/[0.06] disabled:opacity-20 focus-visible:outline-2 focus-visible:outline-[#ff4e26]">
                    {direction === "up" ? <ChevronUp size={17} aria-hidden="true" /> : <ChevronDown size={17} aria-hidden="true" />}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
