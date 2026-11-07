"use client"

import * as React from "react"
import { Dialog } from "@base-ui/react/dialog"
import { AlertDialog } from "@base-ui/react/alert-dialog"
import { Switch as BaseSwitch } from "@base-ui/react/switch"
import { Collapsible } from "@base-ui/react/collapsible"
import { ChevronDown, Loader2, X } from "lucide-react"
import { cn } from "@/lib/utils"

/* ------------------------------------------------------------------------------------------------
 * Overlay shells. Built on Base UI (focus trap, scroll lock, Esc/outside dismissal, aria wiring)
 * and styled in the admin's flat neo-brutalist language.
 * ---------------------------------------------------------------------------------------------- */

const backdropCls =
  "fixed inset-0 z-50 min-h-dvh bg-zinc-950/50 backdrop-blur-[1px] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-black/70 supports-[-webkit-touch-callout:none]:absolute"

type OverlayProps = {
  open: boolean
  /** Called for every close request (Esc, backdrop, close button). The parent decides. */
  onRequestClose: () => void
  title: React.ReactNode
  description?: React.ReactNode
  eyebrow?: React.ReactNode
  footer?: React.ReactNode
  children: React.ReactNode
  className?: string
  initialFocus?: React.RefObject<HTMLElement | null>
}

function OverlayHeader({ eyebrow, title, description }: Pick<OverlayProps, "eyebrow" | "title" | "description">) {
  return (
    <div className="min-w-0 flex-1">
      {eyebrow && (
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[#ff4e26]">{eyebrow}</p>
      )}
      <Dialog.Title className="mt-0.5 text-base font-black uppercase leading-tight tracking-wide text-black dark:text-white sm:text-lg">
        {title}
      </Dialog.Title>
      {description && (
        <Dialog.Description className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          {description}
        </Dialog.Description>
      )}
    </div>
  )
}

function CloseButton() {
  return (
    <Dialog.Close
      aria-label="Close"
      className="-mr-1 inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center border border-transparent text-zinc-500 transition-colors hover:border-zinc-900 hover:bg-white hover:text-black focus-visible:outline-2 focus-visible:outline-[#ff4e26] dark:hover:border-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-white"
    >
      <X size={18} />
    </Dialog.Close>
  )
}

/** Right-hand drawer on desktop, full-screen on mobile. */
export function Sheet({ open, onRequestClose, title, description, eyebrow, footer, children, className, initialFocus }: OverlayProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onRequestClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropCls} />
        <Dialog.Popup
          initialFocus={initialFocus}
          className={cn(
            "fixed inset-0 z-50 flex flex-col bg-[#fbfbf3] text-zinc-900 outline-none dark:bg-zinc-900 dark:text-zinc-100",
            "md:inset-y-0 md:left-auto md:right-0 md:w-[min(46rem,calc(100vw-4rem))] md:border-l-2 md:border-zinc-900 md:shadow-[-6px_0_0_#18181b] dark:md:border-zinc-600 dark:md:shadow-[-6px_0_0_#00000080]",
            "transition-[translate,opacity] duration-200 ease-out data-ending-style:translate-x-8 data-ending-style:opacity-0 data-starting-style:translate-x-8 data-starting-style:opacity-0 motion-reduce:transition-none",
            className,
          )}
        >
          <div className="flex items-start gap-3 border-b-2 border-zinc-900 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-950/40 sm:px-6 sm:py-4">
            <OverlayHeader eyebrow={eyebrow} title={title} description={description} />
            <CloseButton />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
          {footer && (
            <div className="border-t-2 border-zinc-900 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-zinc-700 dark:bg-zinc-950/40 sm:px-6">
              {footer}
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Centered dialog on desktop, full-screen on mobile. */
export function Modal({ open, onRequestClose, title, description, eyebrow, footer, children, className, initialFocus }: OverlayProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onRequestClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropCls} />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-center sm:p-6">
          <Dialog.Popup
            initialFocus={initialFocus}
            className={cn(
              "relative flex max-h-full w-full flex-col bg-[#fbfbf3] text-zinc-900 outline-none dark:bg-zinc-900 dark:text-zinc-100",
              "sm:max-h-[min(54rem,calc(100dvh-3rem))] sm:w-[min(44rem,calc(100vw-3rem))] sm:border-2 sm:border-zinc-900 sm:shadow-[6px_6px_0_#18181b] dark:sm:border-zinc-600 dark:sm:shadow-[6px_6px_0_#00000080]",
              "transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0 motion-reduce:transition-none",
              className,
            )}
          >
            <div className="flex items-start gap-3 border-b-2 border-zinc-900 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-950/40 sm:px-5">
              <OverlayHeader eyebrow={eyebrow} title={title} description={description} />
              <CloseButton />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
            {footer && (
              <div className="border-t-2 border-zinc-900 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-zinc-700 dark:bg-zinc-950/40 sm:px-5">
                {footer}
              </div>
            )}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Small confirmation dialog (alertdialog role, no outside dismissal). */
export function Confirm({
  open,
  onOpenChange,
  title,
  children,
  actions,
  tone = "default",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  children?: React.ReactNode
  actions: React.ReactNode
  tone?: "default" | "danger"
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={backdropCls} />
        <AlertDialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <AlertDialog.Popup
            className={cn(
              "w-full max-w-md border-2 bg-white p-5 text-zinc-900 outline-none dark:bg-zinc-900 dark:text-zinc-100",
              tone === "danger"
                ? "border-red-600 shadow-[5px_5px_0_#dc2626] dark:border-red-500 dark:shadow-[5px_5px_0_#7f1d1d]"
                : "border-zinc-900 shadow-[5px_5px_0_#18181b] dark:border-zinc-600 dark:shadow-[5px_5px_0_#00000080]",
              "transition-[scale,opacity] duration-150 data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0 motion-reduce:transition-none",
            )}
          >
            <AlertDialog.Title className="text-base font-black uppercase tracking-wide">{title}</AlertDialog.Title>
            {children && (
              <div className="mt-2 space-y-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{children}</div>
            )}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{actions}</div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

/* ------------------------------------------------------------------------------------------------
 * Form atoms
 * ---------------------------------------------------------------------------------------------- */

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
  id,
  size = "md",
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  label: string
  id?: string
  size?: "sm" | "md"
}) {
  return (
    <BaseSwitch.Root
      id={id}
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onCheckedChange={(next) => onCheckedChange(next)}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center border-2 border-zinc-900 bg-zinc-200 p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff4e26] data-checked:bg-[#ff4e26] data-disabled:cursor-not-allowed data-disabled:opacity-50 dark:border-zinc-500 dark:bg-zinc-800 dark:data-checked:bg-[#ff4e26]",
        size === "md" ? "h-6 w-11" : "h-5 w-9",
      )}
    >
      <BaseSwitch.Thumb
        className={cn(
          "block border border-zinc-900 bg-white shadow-[1px_1px_0_#18181b] transition-transform duration-150 dark:border-zinc-500",
          size === "md" ? "h-4 w-4 data-checked:translate-x-5" : "h-3 w-3 data-checked:translate-x-4",
        )}
      />
    </BaseSwitch.Root>
  )
}

export function Disclosure({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: React.ReactNode
  summary?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <Collapsible.Root defaultOpen={defaultOpen}>
      <Collapsible.Trigger className="group/trigger flex w-full cursor-pointer items-center gap-3 py-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff4e26]">
        <ChevronDown
          size={16}
          aria-hidden
          className="shrink-0 -rotate-90 text-zinc-500 transition-transform group-data-[panel-open]/trigger:rotate-0"
        />
        <span className="text-xs font-black uppercase tracking-wider">{title}</span>
        {summary && <span className="ml-auto truncate font-mono text-[11px] text-zinc-500">{summary}</span>}
      </Collapsible.Trigger>
      <Collapsible.Panel className="overflow-hidden">{children}</Collapsible.Panel>
    </Collapsible.Root>
  )
}

export const selectCls =
  "h-9 w-full cursor-pointer appearance-none border border-zinc-300 bg-white bg-[length:14px] bg-[right_0.6rem_center] bg-no-repeat px-3 pr-8 text-sm font-medium text-zinc-900 outline-none transition-all focus:border-zinc-900 focus:ring-2 focus:ring-[#ff4e26]/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400 bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]"

export function FieldLabel({
  htmlFor,
  children,
  hint,
  optional,
}: {
  htmlFor?: string
  children: React.ReactNode
  hint?: React.ReactNode
  optional?: boolean
}) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <label htmlFor={htmlFor} className="text-[11px] font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-200">
        {children}
        {optional && <span className="ml-1.5 font-mono text-[10px] font-medium normal-case tracking-normal text-zinc-400">optional</span>}
      </label>
      {hint && <span className="text-right font-mono text-[10px] text-zinc-400">{hint}</span>}
    </div>
  )
}

export function FieldError({ id, children }: { id?: string; children?: React.ReactNode }) {
  if (!children) return null
  return (
    <p id={id} role="alert" className="mt-1 text-[11px] font-semibold text-red-600 dark:text-red-400">
      {children}
    </p>
  )
}

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} aria-hidden className={cn("shrink-0 animate-spin", className)} />
}

/** Tiny mono tag. */
export function Tag({
  children,
  tone = "neutral",
  className,
  title,
}: {
  children: React.ReactNode
  tone?: "neutral" | "accent" | "ok" | "warn" | "danger" | "info"
  className?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1 whitespace-nowrap border px-1.5 py-px font-mono text-[10px] font-bold leading-4",
        tone === "neutral" && "border-zinc-300 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
        tone === "accent" && "border-[#ff4e26] bg-[#ff4e26]/10 text-[#c2341a] dark:text-[#ff7a5c]",
        tone === "ok" && "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
        tone === "warn" && "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
        tone === "danger" && "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300",
        tone === "info" && "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300",
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Inline callout used for errors, warnings and notes inside forms. */
export function Callout({
  tone = "info",
  title,
  children,
  icon,
  className,
}: {
  tone?: "info" | "warn" | "danger" | "ok"
  title?: React.ReactNode
  children?: React.ReactNode
  icon?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex gap-2.5 border-l-4 px-3 py-2.5 text-xs leading-relaxed",
        tone === "info" && "border-zinc-900 bg-zinc-100 text-zinc-700 dark:border-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-300",
        tone === "warn" && "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
        tone === "danger" && "border-red-600 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200",
        tone === "ok" && "border-emerald-600 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
        className,
      )}
    >
      {icon && <span className="mt-px shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">
        {title && <p className="font-black">{title}</p>}
        {children && <div className={cn(title && "mt-0.5")}>{children}</div>}
      </div>
    </div>
  )
}

/** Numbered step heading used inside the editor. */
export function StepHeading({
  index,
  title,
  done,
  aside,
  description,
}: {
  index: number
  title: string
  done?: boolean
  aside?: React.ReactNode
  description?: React.ReactNode
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span
        aria-hidden
        className={cn(
          "inline-flex h-7 w-7 shrink-0 items-center justify-center border-2 font-mono text-xs font-black",
          done
            ? "border-zinc-900 bg-[#ff4e26] text-white shadow-[2px_2px_0_#18181b] dark:border-zinc-500 dark:shadow-[2px_2px_0_#000]"
            : "border-zinc-900 bg-white text-zinc-900 dark:border-zinc-500 dark:bg-zinc-900 dark:text-zinc-100",
        )}
      >
        {String(index).padStart(2, "0")}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="text-sm font-black uppercase tracking-wide text-black dark:text-white">{title}</h3>
          {aside}
        </div>
        {description && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{description}</p>}
      </div>
    </div>
  )
}
