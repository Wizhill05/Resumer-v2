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
        "shrink-0 bg-black",
        orientation === "horizontal" ? "h-[2px] w-full" : "w-[2px] h-full self-stretch",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
