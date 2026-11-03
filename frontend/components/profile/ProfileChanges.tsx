"use client"

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react"

type Work = { dirty: boolean; busy: boolean; discard?: () => void }
type Changes = { register: (id: string, work: Work) => () => void; confirmLeave: (ids?: string[], discard?: boolean) => boolean }
const Context = createContext<Changes>({ register: () => () => {}, confirmLeave: () => true })

export function ProfileChangesProvider({ children }: { children: ReactNode }) {
  const work = useRef(new Map<string, Work>())
  const register = useCallback((id: string, value: Work) => {
    work.current.set(id, value)
    return () => { work.current.delete(id) }
  }, [])
  const confirmLeave = useCallback((ids?: string[], discard = true) => {
    const entries = [...work.current].filter(([id]) => !ids || ids.includes(id)).map(([, value]) => value)
    if (entries.some((value) => value.busy)) {
      window.alert("Please wait for the current save or import to finish.")
      return false
    }
    if (!entries.some((value) => value.dirty)) return true
    if (!window.confirm("Leave and discard your unsaved changes?")) return false
    if (discard) entries.forEach((value) => value.discard?.())
    return true
  }, [])
  useEffect(() => {
    let leaving = false
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!leaving && [...work.current.values()].some((value) => value.dirty || value.busy)) {
        event.preventDefault()
        event.returnValue = ""
      }
    }
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || link.hasAttribute("download")) return
      const target = new URL(link.href, window.location.href)
      if (target.pathname === window.location.pathname && target.origin === window.location.origin) return
      if (!confirmLeave()) { event.preventDefault(); event.stopPropagation() }
      else { leaving = true }
    }
    const traverse = (event: Event) => {
      if ("navigationType" in event && event.navigationType === "traverse" && event.cancelable && !confirmLeave()) event.preventDefault()
    }
    const navigation: unknown = Reflect.get(window, "navigation")
    document.addEventListener("click", click, true)
    window.addEventListener("beforeunload", beforeUnload)
    if (navigation instanceof EventTarget) navigation.addEventListener("navigate", traverse)
    return () => {
      document.removeEventListener("click", click, true)
      window.removeEventListener("beforeunload", beforeUnload)
      if (navigation instanceof EventTarget) navigation.removeEventListener("navigate", traverse)
    }
  }, [confirmLeave])
  return <Context.Provider value={{ register, confirmLeave }}>{children}</Context.Provider>
}

export function useProfileWork(id: string, dirty: boolean, busy = false, discard?: () => void) {
  const { register } = useContext(Context)
  useEffect(() => register(id, { dirty, busy, discard }), [register, id, dirty, busy, discard])
}
export function useProfileChanges() { return useContext(Context) }
