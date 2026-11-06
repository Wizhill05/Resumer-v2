"use client"

import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type FormEventHandler, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { useQuery } from "@tanstack/react-query"
import Image from "next/image"
import styles from "./MobileGenerationBrief.module.css"
import Link from "next/link"
import { AlertCircle, Briefcase, CheckCircle2, ChevronRight, Circle, Eye, FileText, FolderGit2, Info, Loader2, Minus, PanelsTopLeft, Pencil, Plus, X } from "lucide-react"
import { fetchTemplateLayout, fetchTemplatePreview, type TemplateItem, type SectionId } from "@/lib/template-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { TemplateLayoutEditor } from "./TemplateLayoutEditor"
import { TemplatePreviewDialog } from "./TemplatePreviewDialog"
import { MODE_INFO, MODE_LABELS, type CreativityMode } from "./CreativityModeSelector"

type GenerationTemplate = TemplateItem

type Preferences = {
  templateId: string
  split: { projects: number; experience: number }
  mode: CreativityMode
  keywords: string
  instructions: string
  sendEmail: boolean | null
}

type Props = {
  templates: GenerationTemplate[]
  preferences: Preferences
  onPreferencesChange: (preferences: Preferences) => void
  jobDescription: string
  onJobDescriptionChange: (value: string) => void
  onGenerate: FormEventHandler<HTMLFormElement>
  isSubmitting: boolean
  profileProjects: number
  profileExperiences: number
  sectionOrder: SectionId[] | undefined
}

type Editor = "resume" | "mode" | "details" | "email" | null
const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff4e26]"
const outlineButton = `inline-flex min-h-11 items-center justify-center gap-2 border border-zinc-300 bg-white px-3 text-sm font-semibold dark:border-zinc-700 dark:bg-zinc-950 ${focus}`
const modeLabel = (value: CreativityMode) => MODE_LABELS.find((mode) => mode.val === value)?.label ?? value

function subscribeMobile(onChange: () => void) {
  const query = window.matchMedia("(max-width: 767px)")
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}
const getMobile = () => window.matchMedia("(max-width: 767px)").matches

type CloseSheet = (after?: () => void) => void
const SheetCloseContext = createContext<CloseSheet | null>(null)

function MobileSheet({ title, children, action, onDismiss, open = true }: {
  title: string
  children: ReactNode
  action?: ReactNode
  onDismiss: () => void
  open?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const pendingClose = useRef<(() => void) | null>(null)
  const close: CloseSheet = (after = onDismiss) => {
    const element = dialog.current
    if (!element?.open || pendingClose.current) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      after()
      return
    }
    pendingClose.current = after
    element.style.setProperty("--sheet-exit-from", getComputedStyle(element).transform)
    element.dataset.closing = "true"
    Promise.allSettled(element.getAnimations().map((animation) => animation.finished)).then(() => {
      if (dialog.current === element && pendingClose.current === after) {
        pendingClose.current = null
        after()
      }
    })
  }
  useEffect(() => {
    const element = dialog.current
    if (!element || !open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    delete element.dataset.closing
    element.showModal()
    return () => {
      pendingClose.current = null
      element.close()
      document.body.style.overflow = previousOverflow
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [open])

  return (
    <SheetCloseContext.Provider value={close}>
    <dialog ref={dialog} aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); close() }}
      onClick={(event) => { if (event.target === event.currentTarget) close() }}
      className={`${styles.sheet} fixed inset-x-0 bottom-0 top-auto m-0 max-h-[90dvh] w-full max-w-none overflow-hidden border-0 border-t border-zinc-300 bg-[#fbfbf3] p-0 text-zinc-950 backdrop:bg-black/60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100`}>
      <div className="flex max-h-[90dvh] flex-col" onClick={(event) => event.stopPropagation()}>
        <header className="flex shrink-0 items-center justify-between border-b border-zinc-300 px-5 py-2.5 dark:border-zinc-700">
          <h2 id={titleId} tabIndex={-1} autoFocus className="text-xl font-bold outline-none">{title}</h2>
          <button type="button" onClick={() => close()} aria-label={`Close ${title}`} className={`flex h-11 w-11 shrink-0 items-center justify-center ${focus}`}><X size={20} aria-hidden="true" /></button>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-5">{children}</div>
        {action && <footer className="shrink-0 border-t border-zinc-300 bg-white px-5 pt-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] dark:border-zinc-700 dark:bg-zinc-950">{action}</footer>}
      </div>
    </dialog>
    </SheetCloseContext.Provider>
  )
}

function SaveButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  const close = useContext(SheetCloseContext)
  return <Button onClick={() => close ? close(onClick) : onClick()} className={`h-12 w-full border-[#ff4e26] text-sm normal-case tracking-normal shadow-none ${focus}`}>{children}</Button>
}

function BriefRow({ label, summary, onClick }: { label: string; summary: string; onClick: () => void }) {
  return <button type="button" onClick={(event) => { event.currentTarget.focus(); onClick() }} className={`${styles.row} flex min-h-16 w-full items-center justify-between gap-4 border-b border-zinc-300 py-3.5 text-left dark:border-zinc-700 ${focus}`}>
    <span className="min-w-0 space-y-1"><span className="block text-sm font-semibold">{label}</span><span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{summary}</span></span>
    <ChevronRight size={18} className="shrink-0 text-zinc-500" aria-hidden="true" />
  </button>
}

function ContentCounter({ label, value, onChange, icon }: { label: string; value: number; onChange: (delta: number) => void; icon: ReactNode }) {
  return <div className="min-w-0 space-y-3 border border-zinc-300 bg-white p-2.5 dark:border-zinc-700 dark:bg-zinc-950">
    <div className="flex items-center gap-2 text-xs font-semibold">{icon}{label}</div>
    <div className="flex items-center justify-between gap-1">
      <button type="button" onClick={() => onChange(-1)} disabled={value <= 1} aria-label={`Decrease ${label.toLowerCase()}`} className={`flex h-11 w-11 shrink-0 items-center justify-center border border-zinc-300 disabled:opacity-30 dark:border-zinc-700 ${focus}`}><Minus size={14} /></button>
      <output aria-label={`${label} count`} className="text-base font-semibold tabular-nums">{value}</output>
      <button type="button" onClick={() => onChange(1)} disabled={value >= 3} aria-label={`Increase ${label.toLowerCase()}`} className={`flex h-11 w-11 shrink-0 items-center justify-center border border-zinc-300 disabled:opacity-30 dark:border-zinc-700 ${focus}`}><Plus size={14} /></button>
    </div>
  </div>
}

function ResumeSettings({ templates, preferences, onSave, onDismiss, profileProjects, profileExperiences }: {
  templates: GenerationTemplate[]
  preferences: Preferences
  onSave: (value: Preferences) => void
  onDismiss: () => void
  profileProjects: number
  profileExperiences: number
}) {
  const [draft, setDraft] = useState(preferences)
  const [notice, setNotice] = useState<string | null>(null)
  const [editingLayout, setEditingLayout] = useState(false)
  const [preview, setPreview] = useState(false)
  const template = templates.find((item) => item.id === draft.templateId)
  const { data: layout, isError, refetch } = useQuery({
    queryKey: ["template-layout", draft.templateId],
    queryFn: ({ signal }) => fetchTemplateLayout(draft.templateId, signal),
    staleTime: 5 * 60 * 1000,
  })
  const order = layout?.template_id === draft.templateId ? layout.section_order : undefined
  const changeCount = (category: "projects" | "experience", delta: number) => {
    const next = draft.split[category] + delta
    if (next < 1 || next > 3) return
    const split = category === "projects"
      ? next === 1 ? { projects: 1, experience: 3 }
        : next === 2 && draft.split.experience === 1 ? { projects: 2, experience: 2 }
          : { projects: next, experience: draft.split.experience }
      : next === 1 ? { projects: 3, experience: 1 }
        : next === 2 && draft.split.projects === 1 ? { projects: 2, experience: 2 }
          : { projects: draft.split.projects, experience: next }
    setNotice(split.projects !== (category === "projects" ? next : draft.split.projects) || split.experience !== (category === "experience" ? next : draft.split.experience) ? "Adjusted the other count to fit this layout." : null)
    setDraft({ ...draft, split })
  }
  const missing = draft.split.projects > profileProjects || draft.split.experience > profileExperiences

  return <>
    <MobileSheet title="Your résumé" open={!editingLayout} onDismiss={onDismiss} action={<SaveButton onClick={() => onSave(draft)}>Save résumé settings</SaveButton>}>
      <div className="space-y-7">
        <section aria-label="Template" className="space-y-3">
          <h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Template</h3>
          <div role="group" aria-label="Résumé template" className="divide-y divide-zinc-300 border border-zinc-300 dark:divide-zinc-700 dark:border-zinc-700">
            {templates.map((item, index) => {
              const selected = draft.templateId === item.id
              const Icon = index === 0 ? FileText : PanelsTopLeft
              return <button key={item.id} type="button" aria-pressed={selected} onClick={() => setDraft({ ...draft, templateId: item.id })}
                className={`flex min-h-18 w-full items-center gap-3 px-4 py-3 text-left ${focus} ${selected ? "bg-zinc-100 dark:bg-zinc-800" : "bg-white dark:bg-zinc-950"}`}>
                <Icon size={20} className="shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{item.name}</span><span className="mt-1 block text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{item.id === "personal-classic" ? "Serif · Single column" : item.id === "professional-sans" ? "Sans serif · Compact A4" : item.description}</span></span>
                {selected ? <CheckCircle2 size={18} className="shrink-0" aria-hidden="true" /> : <Circle size={18} className="shrink-0 text-zinc-500" aria-hidden="true" />}
              </button>
            })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" disabled={!template} className={outlineButton} onClick={() => setEditingLayout(true)}><Pencil size={16} aria-hidden="true" />Edit layout</button>
            <button type="button" disabled={!template} className={outlineButton} onClick={() => setPreview(true)}><Eye size={16} aria-hidden="true" />Preview</button>
          </div>
          {isError && <p className="text-xs text-amber-700 dark:text-amber-400">Layout preference unavailable. <button type="button" onClick={() => refetch()} className="min-h-11 underline">Retry</button></p>}
        </section>
        <section aria-label="Content" className="space-y-3">
          <h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Content</h3>
          <div className="grid grid-cols-2 gap-3">
            <ContentCounter label="Projects" value={draft.split.projects} onChange={(delta) => changeCount("projects", delta)} icon={<FolderGit2 size={16} className="shrink-0" aria-hidden="true" />} />
            <ContentCounter label="Experience" value={draft.split.experience} onChange={(delta) => changeCount("experience", delta)} icon={<Briefcase size={16} className="shrink-0" aria-hidden="true" />} />
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{profileProjects} projects and {profileExperiences} experiences in your profile</p>
          {notice && <p role="status" className="text-xs text-zinc-600 dark:text-zinc-400">{notice}</p>}
          {missing && <p className="text-xs text-amber-700 dark:text-amber-400">Your profile needs more content for these counts. <Link href="/profile" className="underline">Add to profile</Link></p>}
        </section>
      </div>
    </MobileSheet>
    {template && <TemplateLayoutEditor key={template.id} isOpen={editingLayout} onClose={() => setEditingLayout(false)} templateId={template.id} templateName={template.name} defaultOrder={template.default_section_order} initialAppliedOrder={order} onSaved={() => setEditingLayout(false)} />}
    {preview && template && <TemplatePreviewDialog templateId={template.id} templateName={template.name} sectionOrder={order} expectedSections={template.default_section_order} onClose={() => setPreview(false)} />}
  </>
}

function ModeSettings({ value, onSave, onDismiss }: { value: CreativityMode; onSave: (mode: CreativityMode) => void; onDismiss: () => void }) {
  const [draft, setDraft] = useState(value)
  const [info, setInfo] = useState(false)
  return <MobileSheet title="Generation mode" onDismiss={onDismiss} action={<SaveButton onClick={() => onSave(draft)}>Use {modeLabel(draft)}</SaveButton>}>
    <div role="group" aria-label="Generation mode" className="divide-y divide-zinc-300 border border-zinc-300 dark:divide-zinc-700 dark:border-zinc-700">
      {MODE_LABELS.map((mode) => <button key={mode.val} type="button" aria-pressed={draft === mode.val} onClick={() => setDraft(mode.val)} className={`flex min-h-14 w-full items-center justify-between px-4 text-sm ${focus} ${draft === mode.val ? "bg-zinc-100 font-semibold dark:bg-zinc-800" : "bg-white dark:bg-zinc-950"}`}>{mode.label}{draft === mode.val ? <CheckCircle2 size={18} aria-hidden="true" /> : <Circle size={18} className="text-zinc-500" aria-hidden="true" />}</button>)}
    </div>
    <button type="button" onClick={() => setInfo(!info)} aria-expanded={info} aria-controls="mobile-mode-info" className={`mt-2 flex min-h-12 w-full items-center gap-2 text-left text-xs text-zinc-500 dark:text-zinc-400 ${focus}`}><Info size={16} aria-hidden="true" /><span className="flex-1">About generation modes</span><ChevronRight size={16} className={info ? "rotate-90" : ""} aria-hidden="true" /></button>
    {info && <div id="mobile-mode-info" className="space-y-4 border-t border-zinc-300 pt-4 dark:border-zinc-700">{MODE_INFO.map((mode) => <div key={mode.title}><h3 className="text-sm font-semibold">{mode.title}</h3><p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{mode.body}</p></div>)}</div>}
  </MobileSheet>
}

function DetailsSettings({ preferences, onSave, onDismiss }: { preferences: Preferences; onSave: (value: Preferences) => void; onDismiss: () => void }) {
  const [keywords, setKeywords] = useState(preferences.keywords)
  const [instructions, setInstructions] = useState(preferences.instructions)
  const id = useId()
  return <MobileSheet title="Keywords and instructions" onDismiss={onDismiss} action={<SaveButton onClick={() => onSave({ ...preferences, keywords, instructions })}>Save tailoring details</SaveButton>}>
    <div className="space-y-5">
      <div className="space-y-2"><Label htmlFor={`${id}-keywords`} className="text-sm font-semibold">Target keywords</Label><Input id={`${id}-keywords`} value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="e.g. React, Python, AWS" className="h-12 text-base" /><p className="text-xs text-zinc-500 dark:text-zinc-400">Separate keywords with commas.</p></div>
      <div className="space-y-2"><Label htmlFor={`${id}-instructions`} className="text-sm font-semibold">Custom instructions</Label><Textarea id={`${id}-instructions`} value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={4} className="text-base" placeholder="e.g. Focus on technical contributions" /></div>
    </div>
  </MobileSheet>
}

function EmailSettings({ value, onSave, onDismiss }: { value: boolean | null; onSave: (value: boolean | null) => void; onDismiss: () => void }) {
  const [draft, setDraft] = useState(value)
  return <MobileSheet title="Email notification" onDismiss={onDismiss} action={<SaveButton onClick={() => onSave(draft)}>Save email preference</SaveButton>}>
    <div role="group" aria-label="Email notification" className="divide-y divide-zinc-300 border border-zinc-300 dark:divide-zinc-700 dark:border-zinc-700">{[{ label: "Profile default", value: null }, { label: "Send email", value: true }, { label: "No email", value: false }].map((option) => <button key={option.label} type="button" aria-pressed={draft === option.value} onClick={() => setDraft(option.value)} className={`flex min-h-14 w-full items-center justify-between px-4 text-sm ${focus} ${draft === option.value ? "bg-zinc-100 font-semibold dark:bg-zinc-800" : "bg-white dark:bg-zinc-950"}`}>{option.label}{draft === option.value ? <CheckCircle2 size={18} aria-hidden="true" /> : <Circle size={18} className="text-zinc-500" aria-hidden="true" />}</button>)}</div>
  </MobileSheet>
}

export function MobileGenerationBrief(props: Props) {
  const isMobile = useSyncExternalStore(subscribeMobile, getMobile, () => false)
  return isMobile ? <MobileBriefContent {...props} /> : null
}

function MobileBriefContent(props: Props) {
  const { preferences, onPreferencesChange, templates, sectionOrder } = props
  const [editor, setEditor] = useState<Editor>(null)
  const [preview, setPreview] = useState(false)
  const jobId = useId()
  const formId = `${jobId}-form`
  const template = templates.find((item) => item.id === preferences.templateId)
  const { data: sample, isError, refetch } = useQuery({
    queryKey: ["template-preview", preferences.templateId, sectionOrder],
    queryFn: ({ signal }) => fetchTemplatePreview(preferences.templateId, sectionOrder, signal),
    enabled: !!template,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
  const save = (value: Preferences) => { onPreferencesChange(value); setEditor(null) }
  const missing = props.profileProjects < preferences.split.projects || props.profileExperiences < preferences.split.experience

  return <>
    <form id={formId} onSubmit={props.onGenerate} className="space-y-2.5 pb-28">
      <div className="space-y-2"><Label htmlFor={jobId} className="text-sm font-semibold">Job description *</Label><Textarea id={jobId} required value={props.jobDescription} onChange={(event) => props.onJobDescriptionChange(event.target.value)} rows={6} placeholder="Paste the full job description, including responsibilities and requirements…" className="min-h-40 text-base leading-relaxed" /></div>
      <div className="flex items-center gap-4 pt-4 pb-1">
        {sample?.page_images[0] ? <button type="button" aria-label={`Preview ${template?.name} template sample`} onClick={() => setPreview(true)} className={`relative aspect-[210/297] w-2/5 max-w-36 shrink-0 border border-zinc-300 bg-white ${focus}`}><Image src={sample.page_images[0]} unoptimized fill sizes="144px" alt={`${template?.name} template sample`} className="object-contain object-top" /></button> : <div className="flex aspect-[210/297] w-2/5 max-w-36 shrink-0 flex-col items-center justify-center gap-3 border border-zinc-300 bg-white p-3 text-center text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950">{isError ? <><FileText size={24} aria-hidden="true" /><span>Template sample unavailable</span><button type="button" onClick={() => refetch()} className={`min-h-11 underline ${focus}`}>Retry preview</button></> : <><Loader2 size={20} className="animate-spin" aria-hidden="true" /><span role="status">Loading sample…</span></>}</div>}
        <div className="min-w-0 flex-1 space-y-3"><h2 className="text-lg font-bold leading-snug">{template?.name ?? "Choose a template"}</h2><p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{preferences.split.projects} projects<br />{preferences.split.experience} experience</p><button type="button" onClick={(event) => { event.currentTarget.focus(); setEditor("resume") }} className={`${outlineButton} w-full`}>Change</button><p className="text-[10px] text-zinc-500 dark:text-zinc-400">Template sample</p></div>
      </div>
      {missing && <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400"><AlertCircle size={14} className="shrink-0" aria-hidden="true" /><span>Not enough profile content for these counts. <Link href="/profile" className="underline">Add to profile</Link> or <button type="button" onClick={() => setEditor("resume")} className="underline">change counts</button>.</span></p>}
      <div>
        <BriefRow label="Generation mode" summary={modeLabel(preferences.mode)} onClick={() => setEditor("mode")} />
        <BriefRow label="Keywords and instructions" summary={[preferences.keywords && "Keywords added", preferences.instructions && "Instructions added"].filter(Boolean).join(" · ") || "None added · Optional"} onClick={() => setEditor("details")} />
        <BriefRow label="Email notification" summary={preferences.sendEmail === null ? "Default" : preferences.sendEmail ? "Send email" : "No email"} onClick={() => setEditor("email")} />
      </div>
      {createPortal(<div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-300 bg-white px-5 pt-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] dark:border-zinc-700 dark:bg-zinc-950">
        <Button form={formId} type="submit" disabled={props.isSubmitting || !props.jobDescription.trim()} className={`h-12 w-full border-[#ff4e26] text-sm normal-case tracking-normal shadow-none ${focus}`}>{props.isSubmitting ? <><Loader2 size={18} className="animate-spin" />Generating…</> : "Generate résumé"}</Button>
        <p className="mt-2 text-center text-[11px] text-zinc-500 dark:text-zinc-400">Free beta: 5 builds per day</p>
      </div>, document.body)}
    </form>
    {editor === "resume" && <ResumeSettings templates={templates} preferences={preferences} onSave={save} onDismiss={() => setEditor(null)} profileProjects={props.profileProjects} profileExperiences={props.profileExperiences} />}
    {editor === "mode" && <ModeSettings value={preferences.mode} onSave={(mode) => save({ ...preferences, mode })} onDismiss={() => setEditor(null)} />}
    {editor === "details" && <DetailsSettings preferences={preferences} onSave={save} onDismiss={() => setEditor(null)} />}
    {editor === "email" && <EmailSettings value={preferences.sendEmail} onSave={(sendEmail) => save({ ...preferences, sendEmail })} onDismiss={() => setEditor(null)} />}
    {preview && template && <TemplatePreviewDialog templateId={template.id} templateName={template.name} sectionOrder={sectionOrder} expectedSections={template.default_section_order} onClose={() => setPreview(false)} />}
  </>
}
