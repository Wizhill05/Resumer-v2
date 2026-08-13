import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-20 w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 outline-none transition-all placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:border-zinc-900 dark:focus:border-zinc-400 focus:ring-2 focus:ring-[#ff4e26]/20 dark:focus:ring-[#d65235]/30 disabled:cursor-not-allowed disabled:bg-zinc-100 dark:disabled:bg-zinc-800 disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
