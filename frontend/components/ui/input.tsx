import * as React from "react"
import { cn } from "@/lib/utils"

function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "h-9 w-full bg-white border border-zinc-300 px-3 py-2 text-sm font-medium outline-none transition-all placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-[#ff4e26]/20 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Input }
