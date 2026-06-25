import * as React from "react"
import { cn } from "@/lib/utils"

function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "h-11 w-full bg-white border border-zinc-200 rounded-full px-5 py-2.5 text-sm font-medium text-zinc-900 outline-none transition-all placeholder:text-zinc-400 focus:border-[#ff4e26] focus:ring-2 focus:ring-[#ff4e26]/10 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Input }
