"use client"

import Link from "next/link"
import { startTransition, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertCircle, CheckCircle2, ChevronDown, ChevronRight,
  Loader2, Plus, Trash2, Upload, X, Pencil, FileText,
  Briefcase, FolderGit2, GraduationCap, Award, User, Lock, Menu,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { emptyGuestDraft, loadGuestDraft, mergeGuestDraft, saveGuestDraft } from "@/lib/guest-storage"
import { ReportIssueButton } from "@/components/support/ReportIssueDialog"
import type {
  GuestDraft, GuestEducation, GuestExperience,
  GuestExtracurricular, GuestProject
} from "@/lib/guest-types"

// ── Helpers ───────────────────────────────────────────────────────────────────

const splitLines = (v: string) => v.split("\n").map((l) => l.trim()).filter(Boolean)
const splitCommas = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean)
const hasConsent = () =>
  typeof document !== "undefined" && document.cookie.includes("resumer_guest_consent=true")

type Section = "profile" | "experience" | "projects" | "education" | "extracurriculars" | "generate"

type FocusMode = "balanced" | "exp_focus" | "exp_leaning" | "proj_focus" | "proj_leaning" | "extended"
const FOCUS_OPTIONS: { id: FocusMode; label: string; desc: string; projects: number; experience: number }[] = [
  { id: "balanced",    label: "Balanced",             desc: "2 projects + 2 experiences (Classic format)", projects: 2, experience: 2 },
  { id: "exp_focus",   label: "Experience Focused",   desc: "1 project + 3 experiences (Deep work history)", projects: 1, experience: 3 },
  { id: "exp_leaning", label: "Experience Leaning",   desc: "2 projects + 3 experiences (Experienced roles)", projects: 2, experience: 3 },
  { id: "proj_focus",  label: "Project Focused",      desc: "3 projects + 1 experience (Portfolio showcase)", projects: 3, experience: 1 },
  { id: "proj_leaning",label: "Project Leaning",      desc: "3 projects + 2 experiences (Technical depth)", projects: 3, experience: 2 },
  { id: "extended",    label: "Extended Density",     desc: "3 projects + 3 experiences (Full density)", projects: 3, experience: 3 },
]

// ── Consent Banner ────────────────────────────────────────────────────────────

function ConsentBanner({ accepted, onAccept }: { accepted: boolean; onAccept: () => void }) {
  if (accepted) return null
  return (
    <div className="flex shrink-0 items-start gap-3 border-b border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900">
      <span className="mt-0.5 shrink-0 text-blue-500">ⓘ</span>
      <p className="flex-1 leading-snug text-xs">
        We use an essential session cookie to enforce the 5/day limit and protect your downloads.
        Your draft is saved on this device.{" "}
        <Link href="/privacy" className="underline">Privacy</Link>
      </p>
      <div className="flex shrink-0 gap-2">
        <Link href="/" className="text-xs font-semibold text-blue-700 hover:underline">Decline</Link>
        <button onClick={onAccept} className="rounded bg-blue-600 px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-blue-700">
          Accept
        </button>
      </div>
    </div>
  )
}

// ── Field helper ──────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium text-zinc-500">{label}</Label>
      {children}
    </div>
  )
}

// ── Inline-expandable item row ────────────────────────────────────────────────

function ItemRow({
  title, sub, onDelete, children,
}: {
  title: string; sub?: string; onDelete: () => void; children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
      <div className="flex min-w-0 items-center gap-2 px-3 py-2.5">
        <button type="button" onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
          {open
            ? <ChevronDown size={13} className="shrink-0 text-zinc-400" />
            : <ChevronRight size={13} className="shrink-0 text-zinc-400" />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</p>
            {sub && <p className="truncate text-xs text-zinc-400 dark:text-zinc-500">{sub}</p>}
          </div>
        </button>
        <button type="button" onClick={() => setOpen(!open)} className="shrink-0 cursor-pointer rounded p-1 text-zinc-400 hover:text-zinc-700">
          <Pencil size={12} />
        </button>
        <button type="button" onClick={onDelete} className="shrink-0 cursor-pointer rounded p-1 text-zinc-400 hover:text-red-500">
          <Trash2 size={12} />
        </button>
      </div>
      {open && (
        <div className="border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 px-3 pb-3 pt-2 space-y-3">
          {children}
        </div>
      )}
    </div>
  )
}

// ── Sidebar nav item ──────────────────────────────────────────────────────────

function NavItem({
  icon: Icon, label, count, active, onClick,
}: {
  icon: React.ElementType; label: string; count?: number; active: boolean; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full cursor-pointer items-center gap-2.5 rounded px-3 py-2 text-left text-sm transition-colors ${
        active
          ? "bg-zinc-900 dark:bg-zinc-800 text-white"
          : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 dark:hover:bg-zinc-800 hover:text-zinc-900"
      }`}
    >
      <Icon size={15} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {count !== undefined && (
        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? "bg-white/20 text-white" : "bg-zinc-200 text-zinc-500"}`}>
          {count}
        </span>
      )}
    </button>
  )
}

// ── Add-form card ─────────────────────────────────────────────────────────────

function AddCard({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        <Plus size={14} className="shrink-0 text-zinc-400" />
        {title}
        {open ? <ChevronDown size={13} className="ml-auto text-zinc-400" /> : <ChevronRight size={13} className="ml-auto text-zinc-400" />}
      </button>
      {open && (
        <div className="border-t border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 pb-3 pt-2 space-y-3">
          {children}
        </div>
      )}
    </div>
  )
}

// ── Section panels ────────────────────────────────────────────────────────────

function ProfilePanel({ draft, updateDraft }: { draft: GuestDraft; updateDraft: (d: GuestDraft) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [importStage, setImportStage] = useState<"idle" | "parsing" | "extracting" | "deduplicating">("idle")
  const [fileCount, setFileCount] = useState(0)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [importErr, setImportErr] = useState<string | null>(null)

  const importing = importStage !== "idle"

  const stageLabel =
    importStage === "parsing"
      ? `Reading PDF${fileCount > 1 ? "s" : ""}…`
      : importStage === "extracting"
      ? "Extracting with AI…"
      : importStage === "deduplicating"
      ? "Removing duplicates…"
      : "Extracting…"

  const stageHint =
    importStage === "parsing"
      ? "Parsing document text"
      : importStage === "extracting"
      ? "Running AI extraction — ~10s per file"
      : importStage === "deduplicating"
      ? "Comparing and merging sections"
      : ""

  const importFiles = async (files: File[]) => {
    setImportErr(null); setImportMsg(null); setFileCount(files.length); setImportStage("parsing")
    try {
      const fd = new FormData()
      files.forEach((f) => fd.append("files", f))
      const startRes = await fetch("/api/guest/import/start", { method: "POST", body: fd })
      const startBody = await startRes.json()
      if (!startRes.ok) throw new Error(startBody.detail || startBody.error || "Failed to start import")

      const jobId = startBody.job_id
      let jobStatus = "parsing"
      let jobResult = null
      let jobError = null

      while (jobStatus === "parsing" || jobStatus === "extracting" || jobStatus === "deduplicating") {
        await new Promise((resolve) => setTimeout(resolve, 1500))
        const statusRes = await fetch(`/api/guest/import/status/${jobId}`)
        const statusBody = await statusRes.json()
        if (!statusRes.ok) throw new Error(statusBody.detail || "Failed to check import status")

        jobStatus = statusBody.status
        jobResult = statusBody.result
        jobError = statusBody.error
        setImportStage(jobStatus as "idle" | "parsing" | "extracting" | "deduplicating")
      }

      if (jobStatus === "failed") {
        throw new Error(jobError || "Import failed")
      }

      const body = jobResult
      const { draft: merged, skipped, added } = mergeGuestDraft(draft, body)
      updateDraft(merged)

      // Show soft warning if nothing extracted
      const zeroItems = added === 0
      if (zeroItems) {
        const generalWarning = body.warnings?.find((w: { scope: string }) => w.scope === "general")
        setImportErr(generalWarning?.message || "No data could be extracted from this resume. It may be image-based or use unusual formatting.")
      } else {
        setImportMsg(`Extracted ${added} item${added !== 1 ? "s" : ""}${skipped > 0 ? `, ${skipped} duplicate${skipped !== 1 ? "s" : ""} skipped` : ""}.`)
      }
    } catch (err) {
      setImportErr(err instanceof Error ? err.message : "Import failed")
    } finally { setImportStage("idle") }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Import & Profile</h2>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Upload old resumes to auto-fill, then patch any missing fields.</p>
      </div>

      {/* Drop zone */}
      <div>
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple className="hidden"
          onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) importFiles(f); e.target.value = "" }} />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={importing}
          className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-[#ff4e26]/30 bg-[#ff4e26]/5 py-8 text-sm text-[#ff4e26] transition hover:border-[#ff4e26] hover:bg-[#ff4e26]/10 disabled:opacity-50 cursor-pointer"
        >
          {importing
            ? <><Loader2 size={20} className="animate-spin" /><span className="text-xs font-medium text-zinc-800 dark:text-zinc-200">{stageLabel}</span>{stageHint && <span className="text-xs text-zinc-500 dark:text-zinc-400">{stageHint}</span>}</>
            : <><Upload size={20} className="text-[#ff4e26]" /><span className="font-bold text-zinc-800 dark:text-zinc-200">Click to upload old resumes</span><span className="text-xs text-zinc-500 dark:text-zinc-400 font-semibold">PDF only · up to 5 files · 5 MB each</span></>
          }
        </button>
        {importing && (
          <div className="mt-2 flex items-center gap-2 px-1">
            <div className="flex gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${importStage === "parsing" || importStage === "extracting" || importStage === "deduplicating" ? "bg-[#ff4e26]" : "bg-zinc-300"}`} />
              <span className={`h-1.5 w-1.5 rounded-full ${importStage === "extracting" || importStage === "deduplicating" ? "bg-[#ff4e26]" : "bg-zinc-300"}`} />
              <span className={`h-1.5 w-1.5 rounded-full ${importStage === "deduplicating" ? "bg-[#ff4e26]" : "bg-zinc-300"}`} />
            </div>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {importStage === "parsing" ? "Step 1 of 3" : importStage === "extracting" ? "Step 2 of 3" : "Step 3 of 3"}
            </span>
          </div>
        )}
        {importMsg && (
          <div className="mt-2 flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            <CheckCircle2 size={13} />{importMsg}
            <button onClick={() => setImportMsg(null)} className="ml-auto"><X size={12} /></button>
          </div>
        )}
        {importErr && (
          <div className="mt-2 flex flex-col gap-2 rounded border border-red-200 bg-red-50 px-3 py-2.5">
            <div className="flex items-center gap-2 text-xs text-red-700">
              <AlertCircle size={13} className="shrink-0" />{importErr}
              <button onClick={() => setImportErr(null)} className="ml-auto shrink-0"><X size={12} /></button>
            </div>
            <ReportIssueButton
              defaultCategory="import"
              defaultMessage={`[Guest import failed]\nError: ${importErr}\nStage: ${importStage}\nFiles: ${fileCount}\n\nWhat file did you upload?\n`}
              title="Report guest import failure"
              description="Import error is prefilled. Add file name if possible."
              variant="outline"
              size="xs"
              className="w-fit border-red-300 text-red-700 hover:bg-red-100 bg-white font-black uppercase tracking-wider text-[11px]"
            >
              Report this issue
            </ReportIssueButton>
          </div>
        )}
      </div>

      {/* Profile fields */}
      <div className="grid grid-cols-2 gap-3">
        {([
          ["full_name", "Full name *"], ["email", "Email"],
          ["phone", "Phone"], ["location", "Location"],
          ["linkedin_url", "LinkedIn URL"], ["github_url", "GitHub URL"],
          ["portfolio_url", "Portfolio URL"], ["subtitle", "Headline / Title"],
        ] as [string, string][]).map(([key, lbl]) => (
          <Field key={key} label={lbl}>
            <Input
              value={(draft.profile[key as keyof typeof draft.profile] as string) ?? ""}
              onChange={(e) => updateDraft({ ...draft, profile: { ...draft.profile, [key]: e.target.value } })}
              className="h-8 text-sm"
            />
          </Field>
        ))}
      </div>
      <Field label="Skills (comma-separated)">
        <Input
          value={(draft.profile.skills ?? []).join(", ")}
          placeholder="Python, React, AWS, Docker"
          onChange={(e) => updateDraft({ ...draft, profile: { ...draft.profile, skills: splitCommas(e.target.value) } })}
          className="h-8 text-sm"
        />
      </Field>
      <Field label="Professional summary">
        <Textarea
          rows={4}
          value={draft.profile.summary ?? ""}
          className="resize-none text-sm"
          onChange={(e) => updateDraft({ ...draft, profile: { ...draft.profile, summary: e.target.value } })}
        />
      </Field>
    </div>
  )
}

function ExperiencePanel({ draft, updateDraft }: { draft: GuestDraft; updateDraft: (d: GuestDraft) => void }) {
  const [form, setForm] = useState({ role: "", organization: "", location: "", start_date: "", end_date: "", bullets: "" })

  const add = () => {
    if (!form.role.trim() || !form.organization.trim()) return
    updateDraft({
      ...draft,
      experiences: [...draft.experiences, {
        role: form.role.trim(), organization: form.organization.trim(),
        location: form.location.trim() || null,
        start_date: form.start_date || null, end_date: form.end_date || null,
        bullet_points: splitLines(form.bullets), sort_order: draft.experiences.length,
      }],
    })
    setForm({ role: "", organization: "", location: "", start_date: "", end_date: "", bullets: "" })
  }

  const update = (i: number, patch: Partial<GuestExperience>) => {
    updateDraft({ ...draft, experiences: draft.experiences.map((e, idx) => idx === i ? { ...e, ...patch } : e) })
  }

  const remove = (i: number) => updateDraft({ ...draft, experiences: draft.experiences.filter((_, idx) => idx !== i) })

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Experience</h2>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Add work experience entries. At least 1-3 needed depending on selected focus.</p>
      </div>

      {draft.experiences.length === 0 && (
        <p className="rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-4 py-6 text-center text-sm text-zinc-400">No experience added yet. Import a resume above or add manually.</p>
      )}

      <div className="space-y-2">
        {draft.experiences.map((exp, i) => (
          <ItemRow
            key={i}
            title={`${exp.role} at ${exp.organization}`}
            sub={[exp.location, exp.start_date, exp.end_date ? `→ ${exp.end_date}` : null].filter(Boolean).join(" · ")}
            onDelete={() => remove(i)}
          >
            <div className="grid grid-cols-2 gap-2">
              <Field label="Role"><Input className="h-7 text-xs" value={exp.role} onChange={(e) => update(i, { role: e.target.value })} /></Field>
              <Field label="Organization"><Input className="h-7 text-xs" value={exp.organization} onChange={(e) => update(i, { organization: e.target.value })} /></Field>
              <Field label="Location"><Input className="h-7 text-xs" value={exp.location ?? ""} onChange={(e) => update(i, { location: e.target.value || null })} /></Field>
              <Field label="Start date"><Input className="h-7 text-xs" placeholder="Jan 2022" value={exp.start_date ?? ""} onChange={(e) => update(i, { start_date: e.target.value || null })} /></Field>
              <div className="col-span-2">
                <Field label="End date (or leave blank for Present)"><Input className="h-7 text-xs" placeholder="Present" value={exp.end_date ?? ""} onChange={(e) => update(i, { end_date: e.target.value || null })} /></Field>
              </div>
            </div>
            <Field label="Bullet points (one per line)">
              <Textarea className="resize-none text-xs" rows={4}
                value={(exp.bullet_points ?? []).join("\n")}
                onChange={(e) => update(i, { bullet_points: splitLines(e.target.value) })} />
            </Field>
          </ItemRow>
        ))}
      </div>

      <AddCard title="Add experience">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Role"><Input className="h-7 text-xs" placeholder="Software Engineer" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} /></Field>
          <Field label="Organization"><Input className="h-7 text-xs" placeholder="Acme Corp" value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} /></Field>
          <Field label="Location"><Input className="h-7 text-xs" placeholder="Remote" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
          <Field label="Start date"><Input className="h-7 text-xs" placeholder="Jan 2022" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
          <div className="col-span-2">
            <Field label="End date"><Input className="h-7 text-xs" placeholder="Present" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Field>
          </div>
        </div>
        <Field label="Bullet points (one per line)">
          <Textarea className="resize-none text-xs" rows={3} placeholder="• Built X that achieved Y&#10;• Led team of 4 engineers" value={form.bullets} onChange={(e) => setForm({ ...form, bullets: e.target.value })} />
        </Field>
        <Button type="button" size="sm" onClick={add} disabled={!form.role.trim() || !form.organization.trim()}>
          <Plus size={13} /> Add experience
        </Button>
      </AddCard>
    </div>
  )
}

function ProjectsPanel({ draft, updateDraft }: { draft: GuestDraft; updateDraft: (d: GuestDraft) => void }) {
  const [form, setForm] = useState({ name: "", description: "", technologies: "", github_url: "", bullets: "" })

  const add = () => {
    if (!form.name.trim()) return
    updateDraft({
      ...draft,
      projects: [...draft.projects, {
        name: form.name.trim(), description: form.description.trim() || null,
        technologies: splitCommas(form.technologies),
        github_url: form.github_url.trim() || null,
        bullet_points: splitLines(form.bullets), sort_order: draft.projects.length,
      }],
    })
    setForm({ name: "", description: "", technologies: "", github_url: "", bullets: "" })
  }

  const update = (i: number, patch: Partial<GuestProject>) => {
    updateDraft({ ...draft, projects: draft.projects.map((p, idx) => idx === i ? { ...p, ...patch } : p) })
  }

  const remove = (i: number) => updateDraft({ ...draft, projects: draft.projects.filter((_, idx) => idx !== i) })

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Projects</h2>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Add projects. At least 1-3 needed depending on selected focus.</p>
      </div>

      {draft.projects.length === 0 && (
        <p className="rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-4 py-6 text-center text-sm text-zinc-400">No projects added yet. Import a resume or add manually.</p>
      )}

      <div className="space-y-2">
        {draft.projects.map((proj, i) => (
          <ItemRow
            key={i}
            title={proj.name}
            sub={proj.technologies?.join(", ") || proj.description || ""}
            onDelete={() => remove(i)}
          >
            <div className="grid grid-cols-2 gap-2">
              <Field label="Name"><Input className="h-7 text-xs" value={proj.name} onChange={(e) => update(i, { name: e.target.value })} /></Field>
              <Field label="GitHub URL"><Input className="h-7 text-xs" value={proj.github_url ?? ""} onChange={(e) => update(i, { github_url: e.target.value || null })} /></Field>
              <div className="col-span-2">
                <Field label="Technologies"><Input className="h-7 text-xs" value={(proj.technologies ?? []).join(", ")} onChange={(e) => update(i, { technologies: splitCommas(e.target.value) })} /></Field>
              </div>
              <div className="col-span-2">
                <Field label="Description"><Input className="h-7 text-xs" value={proj.description ?? ""} onChange={(e) => update(i, { description: e.target.value || null })} /></Field>
              </div>
            </div>
            <Field label="Bullet points (one per line)">
              <Textarea className="resize-none text-xs" rows={3}
                value={(proj.bullet_points ?? []).join("\n")}
                onChange={(e) => update(i, { bullet_points: splitLines(e.target.value) })} />
            </Field>
          </ItemRow>
        ))}
      </div>

      <AddCard title="Add project">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Name"><Input className="h-7 text-xs" placeholder="My App" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="GitHub URL"><Input className="h-7 text-xs" placeholder="github.com/…" value={form.github_url} onChange={(e) => setForm({ ...form, github_url: e.target.value })} /></Field>
          <div className="col-span-2">
            <Field label="Technologies (comma-separated)"><Input className="h-7 text-xs" placeholder="React, Node.js, PostgreSQL" value={form.technologies} onChange={(e) => setForm({ ...form, technologies: e.target.value })} /></Field>
          </div>
          <div className="col-span-2">
            <Field label="Short description"><Input className="h-7 text-xs" placeholder="What it does in one line" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          </div>
        </div>
        <Field label="Bullet points (one per line)">
          <Textarea className="resize-none text-xs" rows={3} placeholder="• Built X using Y" value={form.bullets} onChange={(e) => setForm({ ...form, bullets: e.target.value })} />
        </Field>
        <Button type="button" size="sm" onClick={add} disabled={!form.name.trim()}>
          <Plus size={13} /> Add project
        </Button>
      </AddCard>
    </div>
  )
}

function EducationPanel({ draft, updateDraft }: { draft: GuestDraft; updateDraft: (d: GuestDraft) => void }) {
  const [form, setForm] = useState({ degree: "", institution: "", location: "", start_date: "", end_date: "", gpa: "" })

  const add = () => {
    if (!form.degree.trim() || !form.institution.trim()) return
    updateDraft({
      ...draft,
      education: [...draft.education, {
        degree: form.degree.trim(), institution: form.institution.trim(),
        location: form.location.trim() || null,
        start_date: form.start_date || null, end_date: form.end_date || null,
        gpa: form.gpa.trim() || null, sort_order: draft.education.length,
      }],
    })
    setForm({ degree: "", institution: "", location: "", start_date: "", end_date: "", gpa: "" })
  }

  const update = (i: number, patch: Partial<GuestEducation>) => {
    updateDraft({ ...draft, education: draft.education.map((e, idx) => idx === i ? { ...e, ...patch } : e) })
  }

  const remove = (i: number) => updateDraft({ ...draft, education: draft.education.filter((_, idx) => idx !== i) })

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Education</h2>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Degrees, diplomas, certifications.</p>
      </div>

      {draft.education.length === 0 && (
        <p className="rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-4 py-6 text-center text-sm text-zinc-400">No education added yet.</p>
      )}

      <div className="space-y-2">
        {draft.education.map((edu, i) => (
          <ItemRow
            key={i}
            title={`${edu.degree} · ${edu.institution}`}
            sub={[edu.location, edu.end_date, edu.gpa ? `GPA ${edu.gpa}` : null].filter(Boolean).join(" · ")}
            onDelete={() => remove(i)}
          >
            <div className="grid grid-cols-2 gap-2">
              <Field label="Degree"><Input className="h-7 text-xs" value={edu.degree} onChange={(e) => update(i, { degree: e.target.value })} /></Field>
              <Field label="Institution"><Input className="h-7 text-xs" value={edu.institution} onChange={(e) => update(i, { institution: e.target.value })} /></Field>
              <Field label="Location"><Input className="h-7 text-xs" value={edu.location ?? ""} onChange={(e) => update(i, { location: e.target.value || null })} /></Field>
              <Field label="GPA"><Input className="h-7 text-xs" value={edu.gpa ?? ""} onChange={(e) => update(i, { gpa: e.target.value || null })} /></Field>
              <Field label="Start date"><Input className="h-7 text-xs" placeholder="Sep 2020" value={edu.start_date ?? ""} onChange={(e) => update(i, { start_date: e.target.value || null })} /></Field>
              <Field label="End date"><Input className="h-7 text-xs" placeholder="May 2024" value={edu.end_date ?? ""} onChange={(e) => update(i, { end_date: e.target.value || null })} /></Field>
            </div>
          </ItemRow>
        ))}
      </div>

      <AddCard title="Add education">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Degree"><Input className="h-7 text-xs" placeholder="B.Sc. Computer Science" value={form.degree} onChange={(e) => setForm({ ...form, degree: e.target.value })} /></Field>
          <Field label="Institution"><Input className="h-7 text-xs" placeholder="University of X" value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} /></Field>
          <Field label="Location"><Input className="h-7 text-xs" placeholder="City, Country" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
          <Field label="GPA"><Input className="h-7 text-xs" placeholder="3.8" value={form.gpa} onChange={(e) => setForm({ ...form, gpa: e.target.value })} /></Field>
          <Field label="Start date"><Input className="h-7 text-xs" placeholder="Sep 2020" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
          <Field label="End date"><Input className="h-7 text-xs" placeholder="May 2024" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Field>
        </div>
        <Button type="button" size="sm" onClick={add} disabled={!form.degree.trim() || !form.institution.trim()}>
          <Plus size={13} /> Add education
        </Button>
      </AddCard>
    </div>
  )
}

function ExtracurricularsPanel({ draft, updateDraft }: { draft: GuestDraft; updateDraft: (d: GuestDraft) => void }) {
  const [form, setForm] = useState({ title: "", organization: "", description: "", start_date: "", end_date: "", bullets: "" })

  const add = () => {
    if (!form.title.trim()) return
    updateDraft({
      ...draft,
      extracurriculars: [...draft.extracurriculars, {
        title: form.title.trim(), organization: form.organization.trim() || null,
        description: form.description.trim() || null,
        start_date: form.start_date || null, end_date: form.end_date || null,
        bullet_points: splitLines(form.bullets), sort_order: draft.extracurriculars.length,
      }],
    })
    setForm({ title: "", organization: "", description: "", start_date: "", end_date: "", bullets: "" })
  }

  const update = (i: number, patch: Partial<GuestExtracurricular>) => {
    updateDraft({ ...draft, extracurriculars: draft.extracurriculars.map((e, idx) => idx === i ? { ...e, ...patch } : e) })
  }

  const remove = (i: number) => updateDraft({ ...draft, extracurriculars: draft.extracurriculars.filter((_, idx) => idx !== i) })

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Extracurriculars</h2>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Clubs, volunteering, leadership, sports, etc.</p>
      </div>

      {draft.extracurriculars.length === 0 && (
        <p className="rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-4 py-6 text-center text-sm text-zinc-400">No extracurriculars added yet.</p>
      )}

      <div className="space-y-2">
        {draft.extracurriculars.map((extra, i) => (
          <ItemRow
            key={i}
            title={extra.title}
            sub={[extra.organization, extra.start_date, extra.end_date ? `→ ${extra.end_date}` : null].filter(Boolean).join(" · ")}
            onDelete={() => remove(i)}
          >
            <div className="grid grid-cols-2 gap-2">
              <Field label="Title / Role"><Input className="h-7 text-xs" value={extra.title} onChange={(e) => update(i, { title: e.target.value })} /></Field>
              <Field label="Organization"><Input className="h-7 text-xs" value={extra.organization ?? ""} onChange={(e) => update(i, { organization: e.target.value || null })} /></Field>
              <Field label="Start date"><Input className="h-7 text-xs" placeholder="Sep 2021" value={extra.start_date ?? ""} onChange={(e) => update(i, { start_date: e.target.value || null })} /></Field>
              <Field label="End date"><Input className="h-7 text-xs" placeholder="Present" value={extra.end_date ?? ""} onChange={(e) => update(i, { end_date: e.target.value || null })} /></Field>
              <div className="col-span-2">
                <Field label="Description"><Input className="h-7 text-xs" value={extra.description ?? ""} onChange={(e) => update(i, { description: e.target.value || null })} /></Field>
              </div>
            </div>
            <Field label="Bullet points (one per line)">
              <Textarea className="resize-none text-xs" rows={3}
                value={(extra.bullet_points ?? []).join("\n")}
                onChange={(e) => update(i, { bullet_points: splitLines(e.target.value) })} />
            </Field>
          </ItemRow>
        ))}
      </div>

      <AddCard title="Add extracurricular">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Title / Role"><Input className="h-7 text-xs" placeholder="President, Chess Club" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Organization"><Input className="h-7 text-xs" placeholder="Club / Org name" value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} /></Field>
          <Field label="Start date"><Input className="h-7 text-xs" placeholder="Sep 2021" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
          <Field label="End date"><Input className="h-7 text-xs" placeholder="Present" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Field>
          <div className="col-span-2">
            <Field label="Description"><Input className="h-7 text-xs" placeholder="Brief summary" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          </div>
        </div>
        <Field label="Bullet points (one per line)">
          <Textarea className="resize-none text-xs" rows={2} placeholder="• Organised X event with Y attendees" value={form.bullets} onChange={(e) => setForm({ ...form, bullets: e.target.value })} />
        </Field>
        <Button type="button" size="sm" onClick={add} disabled={!form.title.trim()}>
          <Plus size={13} /> Add extracurricular
        </Button>
      </AddCard>
    </div>
  )
}

function GeneratePanel({
  draft, accepted, focus, setFocus,
  jobDescription, setJobDescription,
  keywords, setKeywords,
  instructions, setInstructions,
  error, setError,
}: {
  draft: GuestDraft
  accepted: boolean
  focus: FocusMode
  setFocus: (f: FocusMode) => void
  jobDescription: string
  setJobDescription: (v: string) => void
  keywords: string
  setKeywords: (v: string) => void
  instructions: string
  setInstructions: (v: string) => void
  error: string | null
  setError: (e: string | null) => void
}) {
  const activeFocus = FOCUS_OPTIONS.find((f) => f.id === focus)!
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Generate resume</h2>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Choose a focus, paste the job post, and generate.</p>
      </div>

      {error && (
        <div className="flex flex-col gap-2 rounded border border-red-200 bg-red-50 px-3 py-2.5">
          <div className="flex items-start gap-2 text-xs text-red-700">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span className="flex-1 font-semibold">{error}</span>
            <button onClick={() => setError(null)} className="shrink-0"><X size={12} /></button>
          </div>
          <ReportIssueButton
            defaultCategory="generation"
            defaultMessage={`[Guest generation error]\nError: ${error}\nFocus: ${focus}\nJob description length: ${jobDescription.length}\n\nDescribe steps before this error:\n`}
            title="Report guest generation issue"
            description="Error is prefilled. Add job description context."
            variant="outline"
            size="xs"
            className="w-fit border-red-300 text-red-700 hover:bg-red-100 bg-white font-black uppercase tracking-wider text-[11px]"
          >
            Report this issue
          </ReportIssueButton>
        </div>
      )}

      {/* Focus picker */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
        <p className="border-b border-zinc-100 dark:border-zinc-800 px-4 py-2.5 text-xs font-semibold text-zinc-600 dark:text-zinc-400">Content focus</p>
        <div className="divide-y divide-zinc-100">
          {FOCUS_OPTIONS.map((opt) => {
            const locked = draft.experiences.length < opt.experience || draft.projects.length < opt.projects
            const selected = focus === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                disabled={locked}
                onClick={() => !locked && setFocus(opt.id)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${locked ? "cursor-not-allowed opacity-40" : "cursor-pointer"} ${selected ? "bg-zinc-900 dark:bg-zinc-800 text-white" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${selected ? "border-white bg-white text-zinc-900" : "border-zinc-300"}`}>
                  {selected ? "✓" : ""}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold leading-none ${selected ? "text-white" : "text-zinc-900"}`}>{opt.label}</p>
                  <p className={`mt-0.5 text-xs ${selected ? "text-zinc-300" : "text-zinc-500"}`}>{opt.desc}</p>
                </div>
                {locked && (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500">
                    <Lock size={11} />
                    {`Need ${Math.max(0, opt.experience - draft.experiences.length)} exp · ${Math.max(0, opt.projects - draft.projects.length)} proj`}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Job description */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
        <p className="border-b border-zinc-100 dark:border-zinc-800 px-4 py-2.5 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          Job description <span className="font-normal text-red-500">required</span>
        </p>
        <div className="space-y-3 p-4">
          <Textarea
            rows={10}
            placeholder="Paste the full job posting here for best keyword matching…"
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            className="resize-none text-sm"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Focus keywords (optional)">
              <Input placeholder="Python, AWS, React" className="h-8 text-sm" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
            </Field>
            <Field label="Custom instructions (optional)">
              <Input placeholder="Emphasise backend work" className="h-8 text-sm" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
            </Field>
          </div>
        </div>
      </div>

      {/* Status summary */}
      <div className="rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-4 py-3 text-xs text-zinc-600 space-y-1">
        <p className="font-semibold text-zinc-700 dark:text-zinc-300">Ready to generate?</p>
        {[
          { label: "Name", ok: !!draft.profile.full_name?.trim(), hint: "Add name in Profile" },
          { label: `Experience (need ${activeFocus.experience})`, ok: draft.experiences.length >= activeFocus.experience, hint: `Add ${activeFocus.experience - draft.experiences.length} more` },
          { label: `Projects (need ${activeFocus.projects})`, ok: draft.projects.length >= activeFocus.projects, hint: `Add ${activeFocus.projects - draft.projects.length} more` },
          { label: "Job description", ok: !!jobDescription.trim(), hint: "Paste above" },
          { label: "Cookie consent", ok: accepted, hint: "Accept notice at top" },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <span className={item.ok ? "text-emerald-500" : "text-red-400"}>{item.ok ? "✓" : "✗"}</span>
            <span className={item.ok ? "text-zinc-600" : "text-zinc-500"}>{item.label}</span>
            {!item.ok && <span className="text-zinc-400">— {item.hint}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function TryClient() {
  const router = useRouter()

  const [draft, setDraft] = useState<GuestDraft>(() => emptyGuestDraft())
  const [accepted, setAccepted] = useState(false)
  const [active, setActive] = useState<Section>("profile")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focus, setFocus] = useState<FocusMode>("balanced")
  const [jobDescription, setJobDescription] = useState("")
  const [keywords, setKeywords] = useState("")
  const [instructions, setInstructions] = useState("")

  useEffect(() => {
    startTransition(() => {
      setDraft(loadGuestDraft())
      setAccepted(hasConsent())
    })
  }, [])

  const updateDraft = (next: GuestDraft) => { setDraft(next); saveGuestDraft(next) }

  const acceptCookies = () => {
    document.cookie = "resumer_guest_consent=true; Max-Age=15552000; Path=/; SameSite=Lax"
    setAccepted(true)
  }

  const activeFocus = FOCUS_OPTIONS.find((f) => f.id === focus)!

  const canGenerate = (
    accepted &&
    !!draft.profile.full_name?.trim() &&
    !!jobDescription.trim() &&
    draft.experiences.length >= activeFocus.experience &&
    draft.projects.length >= activeFocus.projects
  )

  const submit = async () => {
    if (!accepted) { setError("Accept the cookie notice at the top to continue."); setActive("generate"); return }
    if (!draft.profile.full_name?.trim()) { setError("Add your name in the Profile section."); setActive("profile"); return }
    if (!jobDescription.trim()) { setError("Paste a job description first."); setActive("generate"); return }
    if (draft.experiences.length < activeFocus.experience) { setError(`Need ${activeFocus.experience} experience entries for ${activeFocus.label}.`); setActive("experience"); return }
    if (draft.projects.length < activeFocus.projects) { setError(`Need ${activeFocus.projects} projects for ${activeFocus.label}.`); setActive("projects"); return }
    setError(null); setSubmitting(true)
    try {
      const res = await fetch("/api/guest/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: "personal-classic",
          job_description: jobDescription,
          keywords: splitCommas(keywords),
          instructions: instructions || null,
          content_split: { projects: activeFocus.projects, experience: activeFocus.experience },
          ...draft,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.detail || body.error || "Failed to start generation")
      router.push(`/try/result/${body.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start generation")
    } finally { setSubmitting(false) }
  }

  const nav: { id: Section; icon: React.ElementType; label: string; count?: number }[] = [
    { id: "profile",         icon: User,        label: "Profile" },
    { id: "experience",      icon: Briefcase,   label: "Experience",      count: draft.experiences.length },
    { id: "projects",        icon: FolderGit2,  label: "Projects",        count: draft.projects.length },
    { id: "education",       icon: GraduationCap, label: "Education",     count: draft.education.length },
    { id: "extracurriculars", icon: Award,      label: "Extracurriculars", count: draft.extracurriculars.length },
    { id: "generate",        icon: FileText,    label: "Generate" },
  ]

  const activeNavItem = nav.find((item) => item.id === active)

  return (
    <div className="flex h-full flex-col relative bg-zinc-50 dark:bg-zinc-900">
      <ConsentBanner accepted={accepted} onAccept={acceptCookies} />

      {/* Mobile Top Tabs Header (hidden on desktop) */}
      <div className="flex gap-2 overflow-x-auto pb-2 p-3 bg-zinc-100 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 md:hidden shrink-0">
        {nav.map((item) => {
          const Icon = item.icon
          const isActive = active === item.id
          const shortLabel = item.id === "profile" ? "Profile" : item.id === "extracurriculars" ? "More" : item.label
          return (
            <button
              key={item.id}
              onClick={() => setActive(item.id)}
              className={`flex shrink-0 select-none items-center gap-1.5 border px-2.5 py-1.5 text-[11px] font-extrabold uppercase tracking-wide transition-colors rounded cursor-pointer ${
                isActive
                  ? "border-zinc-950 dark:border-zinc-700 bg-zinc-950 dark:bg-zinc-800 text-white shadow-[1px_1px_0px_#18181b]"
                  : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 hover:border-zinc-400 dark:hover:border-zinc-500"
              }`}
            >
              <Icon size={12} />
              <span>{shortLabel}</span>
              {item.count !== undefined && (
                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-black ${isActive ? "bg-white/20 text-white" : "bg-zinc-250 text-zinc-500"}`}>
                  {item.count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar (desktop only) */}
        <nav className="hidden md:flex w-52 shrink-0 flex-col gap-1 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-2">
          {nav.map((item) => (
            <NavItem
              key={item.id}
              icon={item.icon}
              label={item.label}
              count={item.count}
              active={active === item.id}
              onClick={() => setActive(item.id)}
            />
          ))}
          <div className="mt-auto pt-3">
            <div className="rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Privacy</p>
              <p className="mt-0.5 text-[11px] font-semibold leading-snug text-zinc-600">
                All data stays on <span className="font-black text-zinc-900 dark:text-zinc-100">your device</span> unless you log in.
              </p>
            </div>
          </div>
        </nav>

        {/* Main content + sticky footer */}
        <div className="flex min-w-0 flex-1 flex-col bg-white dark:bg-zinc-900">
          {/* Scrollable content area */}
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {active === "profile"         && <ProfilePanel draft={draft} updateDraft={updateDraft} />}
            {active === "experience"      && <ExperiencePanel draft={draft} updateDraft={updateDraft} />}
            {active === "projects"        && <ProjectsPanel draft={draft} updateDraft={updateDraft} />}
            {active === "education"       && <EducationPanel draft={draft} updateDraft={updateDraft} />}
            {active === "extracurriculars" && <ExtracurricularsPanel draft={draft} updateDraft={updateDraft} />}
            {active === "generate"        && (
              <GeneratePanel
                draft={draft} accepted={accepted}
                focus={focus} setFocus={setFocus}
                jobDescription={jobDescription} setJobDescription={setJobDescription}
                keywords={keywords} setKeywords={setKeywords}
                instructions={instructions} setInstructions={setInstructions}
                error={error} setError={setError}
              />
            )}
          </div>

          {/* Sticky generate bar — always visible */}
          <div className="shrink-0 border-t border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-5 py-3">
            <div className="flex items-center gap-3">
              <Button
                type="button"
                size="lg"
                className="flex-1"
                onClick={active === "generate" ? submit : () => { setActive("generate"); }}
                disabled={submitting}
              >
                {submitting
                  ? <><Loader2 className="animate-spin" size={16} /> Starting…</>
                  : canGenerate
                    ? "Generate Free Resume"
                    : active === "generate"
                      ? "Generate Free Resume"
                      : "Go to Generate →"
                }
              </Button>
              <div className="shrink-0 text-right">
                <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">5 free / day</p>
                <p className="text-[10px] text-zinc-400">No login needed</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
