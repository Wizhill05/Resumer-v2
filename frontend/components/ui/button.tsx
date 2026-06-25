import * as React from "react"
import { cn } from "@/lib/utils"

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive" | "link"
  size?: "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg"
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", type = "button", ...props }, ref) => {
    return (
      <button
        type={type}
        ref={ref}
        className={cn(
          "inline-flex shrink-0 items-center justify-center font-bold text-sm select-none border-2 border-black transition-all cursor-pointer disabled:pointer-events-none disabled:opacity-50",
          // Variants
          variant === "default" && "bg-[#ff4e26] text-white shadow-[3px_3px_0px_#000000] hover:bg-[#e03d16] hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_#000000] active:translate-x-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0px_#000000]",
          variant === "outline" && "bg-white text-black shadow-[3px_3px_0px_#000000] hover:bg-zinc-50 hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_#000000] active:translate-x-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0px_#000000]",
          variant === "secondary" && "bg-yellow-400 text-black shadow-[3px_3px_0px_#000000] hover:bg-yellow-500 hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_#000000] active:translate-x-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0px_#000000]",
          variant === "ghost" && "border-transparent bg-transparent text-black hover:bg-zinc-200/50 hover:border-black active:bg-zinc-200",
          variant === "destructive" && "bg-red-500 text-white shadow-[3px_3px_0px_#000000] hover:bg-red-600 hover:-translate-y-0.5 hover:shadow-[4px_4px_0px_#000000] active:translate-x-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0px_#000000]",
          variant === "link" && "border-transparent bg-transparent text-black underline underline-offset-4 hover:text-[#ff4e26]",
          // Sizes
          size === "default" && "h-10 px-4 py-2",
          size === "xs" && "h-7 px-2 text-xs",
          size === "sm" && "h-8 px-3 text-xs",
          size === "lg" && "h-12 px-6 text-base",
          size === "icon" && "h-10 w-10 p-0",
          size === "icon-xs" && "h-7 w-7 p-0",
          size === "icon-sm" && "h-8 w-8 p-0",
          size === "icon-lg" && "h-12 w-12 p-0",
          className
        )}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button }
