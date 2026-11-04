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
  onClose: () => void
}

export function TemplatePreviewDialog({ templateId, templateName, sectionOrder, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const { data, isError, refetch } = useQuery({
    queryKey: ["template-preview", templateId, sectionOrder],
    queryFn: ({ signal }) => fetchTemplatePreview(templateId, sectionOrder, signal),
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
      className="fixed inset-0 m-auto max-h-[92dvh] w-[min(92vw,42rem)] max-w-none overflow-visible rounded-lg border-0 bg-transparent p-0 backdrop:bg-black/60">
      <h2 id={titleId} className="sr-only">{templateName} template preview</h2>
      <div className="relative pt-12">
        <button type="button" onClick={() => dialog.current?.close()} aria-label="Close template preview" autoFocus
          className="absolute right-0 top-0 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-zinc-900/80 text-white shadow-sm hover:bg-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff4e26]">
          <X size={20} aria-hidden="true" />
        </button>
        <div className="max-h-[calc(92dvh-3rem)] overflow-y-auto overscroll-contain rounded-lg bg-white">
          {data ? data.page_images.map((src, index) => (
            <Image key={index} unoptimized src={src} width={827} height={1170}
              alt={`${templateName} sample resume, page ${index + 1}`} className="block h-auto w-full" draggable={false} />
          )) : <div className="flex min-h-80 items-center justify-center px-8 text-center text-sm text-zinc-500">
            {isError ? <div role="alert"><p>Could not load the preview.</p><button type="button" onClick={() => refetch()} className="mt-3 min-h-11 px-3 font-medium text-[#ff4e26] underline">Retry</button></div> : <p role="status">Preparing preview…</p>}
          </div>}
        </div>
      </div>
    </dialog>
  )
}
