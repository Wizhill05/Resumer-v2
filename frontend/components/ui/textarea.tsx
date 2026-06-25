import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-24 w-full bg-white border border-zinc-200 rounded-2xl px-5 py-3.5 text-sm font-medium text-zinc-900 outline-none transition-all placeholder:text-zinc-400 focus:border-[#ff4e26] focus:ring-2 focus:ring-[#ff4e26]/10 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
