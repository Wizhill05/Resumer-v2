import * as React from "react"
import { cn } from "@/lib/utils"

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-bold select-none text-zinc-800",
        className
      )}
      {...props}
    />
  )
}

export { Label }
