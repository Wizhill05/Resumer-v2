import * as React from "react"
import { cn } from "@/lib/utils"

export interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical"
}

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorProps) {
  return (
    <div
      className={cn(
        "shrink-0 bg-zinc-200/80",
        orientation === "horizontal" ? "h-[1px] w-full" : "w-[1px] h-full self-stretch",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
