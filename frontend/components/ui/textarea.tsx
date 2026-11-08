import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-20 w-full rounded-md border border-line-strong bg-paper px-3 py-2 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint hover:border-ink/30 focus:border-ember focus:ring-3 focus:ring-ember/15 disabled:cursor-not-allowed disabled:bg-ink/5 disabled:opacity-60",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
