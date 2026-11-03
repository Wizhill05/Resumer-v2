"use client"

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react"
import { createPortal } from "react-dom"

const subscribe = () => () => {}

let openDialogs = 0
let originalOverflow = ""

export function ProfileDialog({ children, label, busy = false, onRequestClose }: {
  children: ReactNode
  label: string
  busy?: boolean
  onRequestClose: () => void
}) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (!mounted) return
    const dialog = dialogRef.current
    if (!dialog) return
    const trigger = document.activeElement
    if (openDialogs++ === 0) {
      originalOverflow = document.body.style.overflow
      document.body.style.overflow = "hidden"
    }
    dialog.showModal()
    dialog.querySelector<HTMLInputElement>("input:not([type=hidden]):not(:disabled)")?.focus({ preventScroll: true })
    return () => {
      dialog.close()
      if (--openDialogs === 0) document.body.style.overflow = originalOverflow
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus()
    }
  }, [mounted])
  if (!mounted) return null
  return createPortal(
    <dialog ref={dialogRef} aria-label={label} aria-busy={busy} className="profile-dialog"
      onCancel={(event) => { event.preventDefault(); if (!busy) onRequestClose() }}
      onClick={(event) => { if (event.target === event.currentTarget && !busy) onRequestClose() }}>
      <div className="profile-dialog-panel">
        <fieldset disabled={busy} className="contents">{children}</fieldset>
      </div>
    </dialog>, document.body,
  )
}
