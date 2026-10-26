"use client"

import { useState } from "react"
import { Loader2, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SUPPORT_CATEGORIES } from "./supportCategories"
import { issueTitle, supportFetch, type SupportThread } from "./supportApi"

export function AdminIssueEditor({
  issue,
  onSaved
}: {
  issue: SupportThread
  onSaved: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(issueTitle(issue))
  const [category, setCategory] = useState(
    issue.category === "feature" ? "feedback" : issue.category || "other"
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await supportFetch(`/api/backend/admin/feedback/reports/${encodeURIComponent(issue.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          ...(title.trim() !== issueTitle(issue) ? { title: title.trim() } : {})
        })
      })
      await onSaved()
      setEditing(false)
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save issue details.")
    } finally {
      setSaving(false)
    }
  }

  if (!editing)
    return (
      <Button
        variant="outline"
        className="min-h-11"
        onClick={() => {
          setTitle(issueTitle(issue))
          setCategory(issue.category === "feature" ? "feedback" : issue.category || "other")
          setEditing(true)
        }}
      >
        <Pencil size={15} /> Edit issue
      </Button>
    )

  return (
    <form
      onSubmit={save}
      className="space-y-4 border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900 sm:p-5"
    >
      <div className="space-y-2">
        <Label htmlFor="admin-issue-title">Issue title</Label>
        <Input
          id="admin-issue-title"
          required
          maxLength={200}
          value={title}
          disabled={saving}
          onChange={(event) => setTitle(event.target.value)}
          className="min-h-11 text-base sm:text-sm"
        />
      </div>
      <fieldset disabled={saving}>
        <legend className="mb-2 text-sm font-bold">Category</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[...SUPPORT_CATEGORIES, { value: "billing", label: "Billing" }].map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={category === option.value}
              onClick={() => setCategory(option.value)}
              className={`min-h-11 border px-3 py-2 text-left text-sm font-bold focus-visible:outline-2 focus-visible:outline-[#ff4e26] ${category === option.value ? "border-[#ff4e26] bg-[#ff4e26]/10" : "border-zinc-300 dark:border-zinc-700"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>
      <p className="text-xs leading-5 text-zinc-500">
        Changes appear in the issue timeline. The original report stays unchanged.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          disabled={saving}
          className="min-h-11"
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={saving || !title.trim()} className="min-h-11">
          {saving && <Loader2 size={15} className="animate-spin" />}Save changes
        </Button>
      </div>
    </form>
  )
}
