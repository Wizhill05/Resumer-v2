import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-20 w-full rounded-md border border-line-strong bg-paper px-3 py-2 text-sm text-ink outline-none transition-[border-color] placeholder:text-ink-faint hover:border-ink/30 focus:border-ember disabled:cursor-not-allowed disabled:bg-ink/5 disabled:opacity-60",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
