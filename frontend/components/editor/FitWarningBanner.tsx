import { AlertTriangle } from "lucide-react"

export function FitWarningBanner({ pageCount }: { pageCount: number }) {
  return (
    <div className="flex items-start gap-2 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-sm">
      <AlertTriangle size={15} className="shrink-0 mt-0.5" />
      <span>
        Content exceeds 1-page fit even at minimum text size. Preview shows{" "}
        <strong>{pageCount} pages</strong>. Download will keep your content.
      </span>
    </div>
  )
}
