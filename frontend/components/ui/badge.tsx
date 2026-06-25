import * as React from "react"
import { cn } from "@/lib/utils"

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "destructive" | "outline"
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider",
        variant === "default" && "bg-orange-50 text-[#ff4e26] border border-orange-100",
        variant === "secondary" && "bg-zinc-100 text-zinc-800 border border-zinc-200",
        variant === "destructive" && "bg-red-50 text-red-600 border border-red-100",
        variant === "outline" && "bg-transparent text-zinc-900 border border-zinc-200",
        className
      )}
      {...props}
    />
  )
}

export { Badge }
