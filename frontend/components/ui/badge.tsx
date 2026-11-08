import * as React from "react"
import { cn } from "@/lib/utils"

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "destructive" | "outline"
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold border",
        variant === "default" && "border-ember/30 bg-ember-tint text-ember",
        variant === "secondary" && "border-line bg-ink/5 text-ink-soft",
        variant === "destructive" && "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
        variant === "outline" && "border-line-strong bg-paper text-ink",
        className
      )}
      {...props}
    />
  )
}

export { Badge }
