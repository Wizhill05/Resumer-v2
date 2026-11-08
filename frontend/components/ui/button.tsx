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
          "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border text-sm font-semibold select-none transition-[background-color,border-color,box-shadow,color,transform] cursor-pointer disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember",
          // Variants
          variant === "default" && "border-[#e03d16] bg-gradient-to-b from-[#ff6a45] to-[#ff4e26] text-white shadow-[0_8px_20px_-10px_rgb(255_78_38/70%)] hover:from-[#ff5a33] hover:to-[#ec4520] active:translate-y-px",
          variant === "outline" && "border-line-strong bg-paper/70 text-ink backdrop-blur-sm hover:border-ink/30 hover:bg-paper active:translate-y-px",
          variant === "secondary" && "border-ink bg-ink text-paper shadow-[0_8px_20px_-12px_rgb(35_10_4/60%)] hover:opacity-90 active:translate-y-px",
          variant === "ghost" && "border-transparent bg-transparent text-ink hover:bg-ink/5 active:bg-ink/10",
          variant === "destructive" && "border-red-600/80 bg-red-500 text-white hover:bg-red-600 active:translate-y-px",
          variant === "link" && "border-transparent bg-transparent text-ink underline underline-offset-4 hover:text-ember",
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
