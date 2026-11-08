"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { FIELD_CLASS, Note, Panel, sendJson } from "../shared"

export function TemplatesTab() {
  const [templateId, setTemplateId] = useState("personal-classic")
  const [context, setContext] = useState("{}")
  const [html, setHtml] = useState("")
  const [parseError, setParseError] = useState<string | null>(null)

  const render = useMutation({
    mutationFn: async () => {
      let parsed: unknown
      try {
        parsed = JSON.parse(context)
      } catch {
        throw new Error("Render context is not valid JSON.")
      }
      return sendJson<{ html?: string }>("/api/backend/admin/templates/sandbox/render", "POST", { template_id: templateId, context: parsed }, "Template render failed")
    },
    onSuccess: (data) => { setParseError(null); setHtml(data.html || "") },
    onError: (err) => setParseError(err instanceof Error ? err.message : "Template render failed"),
  })

  return (
    <div className="grid gap-4 pixel-enter lg:grid-cols-2">
      <Panel className="space-y-3">
        <Label htmlFor="template-id" className="text-xs font-bold">Template ID</Label>
        <input id="template-id" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={FIELD_CLASS} />
        <Label htmlFor="template-context" className="text-xs font-bold">Render context JSON</Label>
        <Textarea id="template-context" rows={14} className="font-mono text-xs" value={context} onChange={(e) => setContext(e.target.value)} />
        {parseError && <Note tone="error">{parseError}</Note>}
        <Button className="min-h-11 w-full sm:w-auto" onClick={() => render.mutate()} disabled={render.isPending}>
          {render.isPending ? "Rendering..." : "Render sandbox"}
        </Button>
      </Panel>
      <Panel>
        {html ? (
          <iframe title="Template preview" className="h-[70dvh] w-full border border-zinc-200 bg-white lg:h-[650px]" srcDoc={html} />
        ) : (
          <div className="flex h-40 items-center justify-center text-sm font-semibold text-zinc-400">Render output appears here.</div>
        )}
      </Panel>
    </div>
  )
}
