"use client"
import { Button } from "@/components/ui/button"
export function QueryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div role="alert" className="space-y-3 border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200 rounded-md">
    <p>{message}</p><Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>
  </div>
}
