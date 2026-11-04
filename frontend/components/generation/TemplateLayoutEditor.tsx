"use client"

import { useEffect, useState, useRef, useId, useCallback } from "react"
import { createPortal } from "react-dom"
import { X, RotateCcw, Check, LayoutList, Eye, AlertCircle } from "lucide-react"
import {
  DEFAULT_SECTION_ORDER,
  type SectionId,
  fetchTemplateLayout,
  saveTemplateLayout,
} from "@/lib/template-layout"
import { SectionOrderList } from "./SectionOrderList"
import { TemplateLayoutOutline } from "./TemplateLayoutOutline"

type TemplateLayoutEditorProps = {
  isOpen: boolean
  onClose: () => void
  templateId: string
  templateName?: string
  initialAppliedOrder?: SectionId[] | null
  defaultOrder?: SectionId[]
  onSaved: (newOrder: SectionId[]) => void
}

function isElementVisible(el: HTMLElement): boolean {
  if (el.getAttribute("aria-hidden") === "true") return false
  if (el.closest('[aria-hidden="true"]')) return false
  const style = window.getComputedStyle(el)
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.visibility === "collapse"
  ) {
    return false
  }
  return (
    el.getClientRects().length > 0 ||
    el.offsetWidth > 0 ||
    el.offsetHeight > 0
  )
}

export function TemplateLayoutEditor({
  isOpen,
  onClose,
  templateId,
  templateName = "Personal Classic",
  initialAppliedOrder,
  defaultOrder = [...DEFAULT_SECTION_ORDER],
  onSaved,
}: TemplateLayoutEditorProps) {
  const dialogId = useId()
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  // Layout states
  const [templateDefault, setTemplateDefault] = useState<SectionId[]>(defaultOrder)
  const [draftOrder, setDraftOrder] = useState<SectionId[]>(
    initialAppliedOrder ? [...initialAppliedOrder] : [...defaultOrder]
  )
  const [appliedOrder, setAppliedOrder] = useState<SectionId[]>(
    initialAppliedOrder ? [...initialAppliedOrder] : [...defaultOrder]
  )

  // Hover sync between controls and preview
  const [hoveredSection, setHoveredSection] = useState<SectionId | null>(null)

  // Network & UI states
  const [isLoading, setIsLoading] = useState(false)
  const [loadRetry, setLoadRetry] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [mobileTab, setMobileTab] = useState<"sections" | "preview">("sections")

  // Check if draft order has changed from currently applied order
  const isDirty = draftOrder.some((id, idx) => id !== appliedOrder[idx])

  // Load saved preference from backend on open or template switch
  useEffect(() => {
    if (!isOpen || !templateId) return

    let isMounted = true
    const abortController = new AbortController()

    async function loadLayout() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const data = await fetchTemplateLayout(templateId, abortController.signal)
        if (!isMounted) return

        setTemplateDefault(data.default_section_order)
        setAppliedOrder(data.section_order)
        setDraftOrder([...data.section_order])
      } catch (err) {
        if (!isMounted || abortController.signal.aborted) return
        // Do not overwrite existing draft or applied order if fetch fails
        setLoadError(
          err instanceof Error ? err.message : "Failed to load template layout"
        )
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadLayout()

    return () => {
      isMounted = false
      abortController.abort()
    }
  }, [isOpen, templateId, loadRetry])

  const handleClose = useCallback(() => {
    if (isSaving) return
    if (isDirty) {
      if (!window.confirm("Discard unsaved layout changes?")) {
        return
      }
    }
    // Discard draft changes and close
    setDraftOrder([...appliedOrder])
    setSaveError(null)
    onClose()
  }, [isSaving, isDirty, appliedOrder, onClose])

  // Keep ref to handleClose to prevent tearing down listeners on every isDirty/draftOrder change
  const handleCloseRef = useRef(handleClose)
  useEffect(() => {
    handleCloseRef.current = handleClose
  }, [handleClose])

  const handleResetToDefault = useCallback(() => {
    if (isSaving) return
    setDraftOrder([...templateDefault])
    setSaveError(null)
  }, [isSaving, templateDefault])

  const handleSave = useCallback(async () => {
    if (isSaving || isLoading || loadError || !templateId) return
    setIsSaving(true)
    setSaveError(null)

    try {
      const res = await saveTemplateLayout(templateId, draftOrder)
      setAppliedOrder(res.section_order)
      setDraftOrder([...res.section_order])
      onSaved(res.section_order)
      onClose()
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to persist template layout"
      )
    } finally {
      setIsSaving(false)
    }
  }, [isSaving, isLoading, loadError, templateId, draftOrder, onSaved, onClose])

  // Background inert, body scroll lock, and opener focus restoration
  useEffect(() => {
    if (!isOpen) return

    // Capture opener element when dialog opens
    openerRef.current = (document.activeElement as HTMLElement) || null

    const dialogEl = dialogRef.current
    const elementsToRestoreInert: HTMLElement[] = []

    if (dialogEl && typeof document !== "undefined") {
      const bodyChildren = Array.from(document.body.children)
      for (const child of bodyChildren) {
        if (child instanceof HTMLElement && child !== dialogEl && !child.contains(dialogEl)) {
          if (!child.hasAttribute("inert")) {
            child.setAttribute("inert", "")
            elementsToRestoreInert.push(child)
          }
        }
      }
    }

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    return () => {
      for (const el of elementsToRestoreInert) {
        el.removeAttribute("inert")
      }
      document.body.style.overflow = prevOverflow

      // Restore focus to opener element upon close
      requestAnimationFrame(() => {
        openerRef.current?.focus()
      })
    }
  }, [isOpen])

  // Initial autofocus: runs ONCE when dialog opens, never on isDirty or draft reorder changes
  useEffect(() => {
    if (!isOpen) return

    const timer = requestAnimationFrame(() => {
      const autofocusBtn = dialogRef.current?.querySelector<HTMLButtonElement>(
        '[data-autofocus="true"]'
      )
      autofocusBtn?.focus()
    })

    return () => cancelAnimationFrame(timer)
  }, [isOpen])

  // Focus trap & Escape key handling (filters hidden mobile controls and ignores handled Escapes)
  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return

      if (e.key === "Escape") {
        e.preventDefault()
        handleCloseRef.current()
        return
      }

      if (e.key === "Tab" && dialogRef.current) {
        const rawElements = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        )

        // Filter out hidden elements (e.g. controls inside inactive mobile tabs or hidden responsive buttons)
        const focusableElements = rawElements.filter(isElementVisible)

        if (focusableElements.length === 0) {
          e.preventDefault()
          return
        }

        const firstElement = focusableElements[0]
        const lastElement = focusableElements[focusableElements.length - 1]
        const activeEl = document.activeElement as HTMLElement | null

        if (e.shiftKey) {
          if (activeEl === firstElement || !focusableElements.includes(activeEl as HTMLElement)) {
            e.preventDefault()
            lastElement.focus()
          }
        } else {
          if (activeEl === lastElement || !focusableElements.includes(activeEl as HTMLElement)) {
            e.preventDefault()
            firstElement.focus()
          }
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isOpen])

  if (!isOpen) return null

  return createPortal(
    <div ref={dialogRef} id={dialogId} role="dialog" aria-modal="true" aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex h-dvh flex-col overflow-hidden bg-white text-zinc-900 [color-scheme:light] dark:bg-zinc-950 dark:text-zinc-100 dark:[color-scheme:dark]">
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 px-4 py-3 sm:px-6 dark:border-zinc-800">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-base font-semibold sm:text-lg">Edit template</h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{templateName}</p>
        </div>
        <button type="button" data-autofocus="true" onClick={handleClose} disabled={isSaving}
          aria-label="Close template layout editor"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-[#ff4e26]">
          <X size={21} aria-hidden="true" />
        </button>
      </header>
      <div className="flex shrink-0 border-b border-zinc-200 px-4 md:hidden dark:border-zinc-800" role="tablist" aria-label="Template editor views">
        {(["sections", "preview"] as const).map((tab) => (
          <button key={tab} id={`${dialogId}-${tab}-tab`} type="button" role="tab" aria-selected={mobileTab === tab}
            aria-controls={`${dialogId}-${tab}`} onClick={() => setMobileTab(tab)}
            onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); const next = tab === "sections" ? "preview" : "sections"; setMobileTab(next); document.getElementById(`${dialogId}-${next}-tab`)?.focus() } }}
            className={`flex min-h-12 flex-1 items-center justify-center gap-2 border-b-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-[#ff4e26] ${mobileTab === tab ? "border-[#ff4e26] text-[#ff4e26]" : "border-transparent text-zinc-500"}`}>
            {tab === "sections" ? <LayoutList size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
            {tab === "sections" ? "Sections" : "Preview"}
          </button>
        ))}
      </div>
      {(loadError || saveError) && (
        <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <AlertCircle size={18} className="shrink-0" aria-hidden="true" />
          <span className="flex-1">{loadError ? "Could not load your saved layout." : "Could not save your layout. Your changes are still here."}</span>
          <button type="button" disabled={isSaving} onClick={() => loadError ? setLoadRetry((v) => v + 1) : handleSave()} className="min-h-11 px-2 font-semibold underline">Retry</button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <section id={`${dialogId}-sections`} aria-label="Section order" data-section-scroll
          className={`min-h-0 w-full overflow-y-auto overscroll-contain px-4 py-5 md:w-[42%] md:max-w-lg md:border-r md:px-6 md:py-6 dark:border-zinc-800 ${mobileTab === "preview" ? "hidden md:block" : "block"}`}>
          <h3 className="hidden md:block text-base font-semibold">Make it your order</h3>
          <p className="mb-4 text-sm leading-relaxed text-zinc-500 md:mt-1 dark:text-zinc-400">Drag the left grip to move a section, or use the arrows.</p>
          {isLoading ? <p className="py-8 text-sm text-zinc-500" role="status">Loading your layout…</p> :
            <SectionOrderList items={draftOrder} onChange={setDraftOrder} onHoverSection={setHoveredSection} disabled={isSaving || !!loadError} />}
          <p className="mt-5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">Empty sections are skipped. This layout applies to future resumes; existing resumes keep their order.</p>
        </section>
        <section id={`${dialogId}-preview`} aria-label="Template preview" className={`min-h-0 min-w-0 flex-1 ${mobileTab === "sections" ? "hidden md:block" : "block"}`}>
          {!isLoading && !loadError && <TemplateLayoutOutline templateId={templateId} sectionOrder={draftOrder} templateName={templateName} activeHoverSection={hoveredSection} />}
        </section>
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-zinc-200 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 dark:border-zinc-800 dark:bg-zinc-950">
        <button type="button" onClick={handleResetToDefault} disabled={isSaving || isLoading || !!loadError}
          className="flex min-h-11 items-center gap-2 rounded-lg px-1 sm:px-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800">
          <RotateCcw size={16} aria-hidden="true" />Reset
        </button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={handleClose} disabled={isSaving} className="min-h-11 rounded-lg border border-zinc-200 px-2.5 sm:px-3 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">Cancel</button>
          <button type="button" onClick={handleSave} disabled={isSaving || isLoading || !!loadError || !isDirty}
            className="flex min-h-11 items-center gap-2 rounded-lg bg-[#ff4e26] px-3 sm:px-4 whitespace-nowrap text-sm font-semibold text-white hover:bg-[#e6411e] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff4e26]">
            <Check size={17} aria-hidden="true" />{isSaving ? "Saving…" : "Save layout"}
          </button>
        </div>
      </footer>
    </div>, document.body
  )
}
