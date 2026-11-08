"use client"

import { useCallback, useEffect, useSyncExternalStore } from "react"
import { useSession } from "next-auth/react"
import { useWatch, type FieldValues, type UseFormReturn } from "react-hook-form"
import { z } from "zod"
import { Button } from "@/components/ui/button"

const draftEvent = "profile-draft-changed"
function subscribe(listener: () => void) {
  window.addEventListener(draftEvent, listener)
  return () => window.removeEventListener(draftEvent, listener)
}

export function useProfileDraft<T extends FieldValues>({ kind, recordId, active, form, schema }: {
  kind: string
  recordId: string | null
  active: boolean
  form: UseFormReturn<T>
  schema: z.ZodType<T>
}) {
  const { data: session } = useSession()
  const key = session?.user?.email ? `resumer:profile:${session.user.email}:${kind}:${recordId ?? "new"}` : null
  const values = useWatch({ control: form.control })
  const dirty = form.formState.isDirty
  const read = useCallback(() => {
    try { return key && active ? sessionStorage.getItem(key) : null } catch { return null }
  }, [key, active])
  const stored = useSyncExternalStore(subscribe, read, () => null)
  const clear = useCallback(() => {
    try { if (key) sessionStorage.removeItem(key) } catch {}
    window.dispatchEvent(new Event(draftEvent))
  }, [key])
  useEffect(() => {
    if (!active || !dirty || !key) return
    try { sessionStorage.setItem(key, JSON.stringify(values)) } catch {}
    window.dispatchEvent(new Event(draftEvent))
  }, [active, dirty, key, values])

  let recovered: T | null = null
  if (stored && active && !dirty) {
    try {
      const raw: unknown = JSON.parse(stored)
      const result = schema.safeParse(raw)
      if (result.success) recovered = result.data
    } catch {}
  }
  const restore = () => { if (recovered) form.reset(recovered, { keepDefaultValues: true }) }
  const notice = recovered ? <div className="flex flex-wrap items-center gap-3 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100 rounded-md" role="status">
    <p>You have an unsaved draft from this browser session.</p>
    <Button size="sm" variant="outline" onClick={restore}>Restore draft</Button>
    <Button size="sm" variant="ghost" onClick={clear}>Discard draft</Button>
  </div> : null
  return { clear, notice }
}
