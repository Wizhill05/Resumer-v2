import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-20 w-full bg-white border border-zinc-300 px-3 py-2 text-sm font-medium outline-none transition-all placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-[#ff4e26]/20 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
