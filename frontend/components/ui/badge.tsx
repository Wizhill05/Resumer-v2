import * as React from "react"
import { cn } from "@/lib/utils"

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "destructive" | "outline"
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center font-bold px-2.5 py-0.5 text-xs border-2 border-black dark:border-zinc-600 transition-all shadow-[2px_2px_0px_#000000] dark:shadow-[2px_2px_0px_#3f3f46]",
        variant === "default" && "bg-[#ff4e26] text-white",
        variant === "secondary" && "bg-yellow-400 text-black",
        variant === "destructive" && "bg-red-500 text-white",
        variant === "outline" && "bg-white dark:bg-zinc-900 text-black dark:text-zinc-100",
        className
      )}
      {...props}
    />
  )
}

export { Badge }
