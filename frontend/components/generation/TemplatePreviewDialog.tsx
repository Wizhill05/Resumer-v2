"use client"

import { useEffect, useId, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import Image from "next/image"
import { X } from "lucide-react"
import { fetchTemplatePreview, type SectionId } from "@/lib/template-layout"

type Props = {
  templateId: string
  templateName: string
  sectionOrder?: SectionId[]
  expectedSections?: readonly SectionId[]
  onClose: () => void
}

export function TemplatePreviewDialog({
  templateId,
  templateName,
  sectionOrder,
  expectedSections,
  onClose,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const { data, isError, refetch } = useQuery({
    queryKey: ["template-preview", templateId, sectionOrder, expectedSections],
    queryFn: ({ signal }) => fetchTemplatePreview(templateId, sectionOrder, signal, expectedSections),
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  useEffect(() => {
    const el = dialog.current
    el?.showModal()
    return () => el?.close()
  }, [])

  return (
    <dialog ref={dialog} aria-labelledby={titleId} onClose={() => { if (!dialog.current?.open) onClose() }}
      onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close() }}
      className="fixed inset-0 m-auto h-fit max-h-none w-fit max-w-none overflow-visible border-0 bg-transparent p-0 backdrop:bg-[rgb(35_10_4/45%)] backdrop:backdrop-blur-[2px]">
      <h2 id={titleId} className="sr-only">{templateName} template preview</h2>
      {/* One page at its real A4 ratio, sized to fit the screen whole (no scrolling),
          with the close button beside it on the right. */}
      <div className="flex items-start gap-2 sm:gap-3">
        <div
          className="relative aspect-[210/297] shrink-0 overflow-hidden rounded-[3px] bg-white shadow-[0_24px_60px_-20px_rgb(35_10_4/55%)]"
          style={{ width: "min(calc(100vw - 4.75rem), 42rem, calc((100dvh - 2rem) * 210 / 297))" }}
        >
          {data?.page_images[0] ? (
            <Image unoptimized src={data.page_images[0]} fill sizes="(max-width: 768px) 92vw, 672px"
              alt={`${templateName} sample resume`} className="object-contain" draggable={false} />
          ) : <div className="flex h-full w-full items-center justify-center bg-paper px-8 text-center text-sm text-ink-muted">
            {isError ? <div role="alert"><p>Could not load the preview.</p><button type="button" onClick={() => refetch()} className="mt-3 min-h-11 px-3 font-medium text-[#ff4e26] underline">Retry</button></div> : <p role="status">Preparing preview…</p>}
          </div>}
        </div>
        <button type="button" onClick={() => dialog.current?.close()} aria-label="Close template preview" autoFocus
          className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-line bg-paper text-ink shadow-soft-lg transition-colors hover:border-ember/50 hover:text-ember focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff4e26]">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
    </dialog>
  )
}
