import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-20 w-full bg-white border-2 border-black px-3 py-2 text-sm font-medium outline-none transition-all placeholder:text-zinc-500 focus:shadow-[3px_3px_0px_#ff4e26] focus:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
