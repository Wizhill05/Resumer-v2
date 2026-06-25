import * as React from "react"
import { cn } from "@/lib/utils"

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "destructive" | "outline"
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center font-bold px-2.5 py-0.5 text-xs border-2 border-black transition-all shadow-[2px_2px_0px_#000000]",
        variant === "default" && "bg-[#ff4e26] text-white",
        variant === "secondary" && "bg-yellow-400 text-black",
        variant === "destructive" && "bg-red-500 text-white",
        variant === "outline" && "bg-white text-black",
        className
      )}
      {...props}
    />
  )
}

export { Badge }
