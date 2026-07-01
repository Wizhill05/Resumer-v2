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
          "inline-flex shrink-0 items-center justify-center gap-2 font-bold text-sm select-none border transition-all cursor-pointer disabled:pointer-events-none disabled:opacity-50",
          // Variants
          variant === "default" && "border-[#18181b] bg-[#ff4e26] text-white shadow-[2px_2px_0px_#18181b] hover:bg-[#e03d16] active:translate-y-px active:shadow-none md:hover:-translate-y-0.5",
          variant === "outline" && "border-zinc-300 bg-white text-black hover:border-zinc-900 hover:bg-zinc-50 active:translate-y-px",
          variant === "secondary" && "border-zinc-900 bg-yellow-300 text-black shadow-[2px_2px_0px_#18181b] hover:bg-yellow-400 active:translate-y-px active:shadow-none md:hover:-translate-y-0.5",
          variant === "ghost" && "border-transparent bg-transparent text-black hover:bg-zinc-100 active:bg-zinc-200",
          variant === "destructive" && "border-red-600 bg-red-500 text-white hover:bg-red-600 active:translate-y-px",
          variant === "link" && "border-transparent bg-transparent text-black underline underline-offset-4 hover:text-[#ff4e26]",
          // Sizes
          size === "default" && "h-9 px-3 py-2",
          size === "xs" && "h-7 px-2 text-xs",
          size === "sm" && "h-8 px-2.5 text-xs",
          size === "lg" && "h-10 px-4 text-sm md:h-11 md:px-5 md:text-base",
          size === "icon" && "h-9 w-9 p-0",
          size === "icon-xs" && "h-7 w-7 p-0",
          size === "icon-sm" && "h-8 w-8 p-0",
          size === "icon-lg" && "h-10 w-10 md:h-11 md:w-11 p-0",
          className
        )}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button }
