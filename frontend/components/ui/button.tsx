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
          "inline-flex shrink-0 items-center justify-center gap-2 border text-sm font-black uppercase tracking-wide select-none transition-all cursor-pointer disabled:pointer-events-none disabled:opacity-50",
          // Variants
          variant === "default" && "border-[#18181b] dark:border-[#52525b] bg-[#ff4e26] dark:bg-[#d65235] text-white shadow-[2px_2px_0px_#18181b] dark:shadow-[2px_2px_0px_#3f3f46] hover:bg-[#e03d16] dark:hover:bg-[#b8432a] active:translate-y-px active:shadow-none md:hover:-translate-y-0.5",
          variant === "outline" && "border-zinc-900 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-black dark:text-zinc-100 shadow-[2px_2px_0px_#18181b] dark:shadow-[2px_2px_0px_#3f3f46] hover:bg-zinc-50 dark:hover:bg-zinc-800 active:translate-y-px active:shadow-none md:hover:-translate-y-0.5",
          variant === "secondary" && "border-zinc-900 dark:border-zinc-600 bg-yellow-300 text-black shadow-[2px_2px_0px_#18181b] dark:shadow-[2px_2px_0px_#3f3f46] hover:bg-yellow-400 active:translate-y-px active:shadow-none md:hover:-translate-y-0.5",
          variant === "ghost" && "border-transparent bg-transparent text-black dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 active:bg-zinc-200 dark:active:bg-zinc-700",
          variant === "destructive" && "border-red-600 bg-red-500 text-white hover:bg-red-600 active:translate-y-px",
          variant === "link" && "border-transparent bg-transparent text-black dark:text-zinc-200 underline underline-offset-4 hover:text-[#ff4e26] dark:hover:text-[#d65235]",
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
