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
          "inline-flex shrink-0 items-center justify-center font-bold tracking-tight rounded-full transition-all duration-200 ease-out select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
          // Variants
          variant === "default" && "bg-[#ff4e26] text-white hover:bg-[#e03d16] hover:shadow-md hover:shadow-orange-500/15",
          variant === "outline" && "border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50 hover:border-zinc-300",
          variant === "secondary" && "bg-zinc-100 text-zinc-900 hover:bg-zinc-200",
          variant === "ghost" && "bg-transparent text-zinc-900 hover:bg-zinc-100",
          variant === "destructive" && "bg-red-500 text-white hover:bg-red-600",
          variant === "link" && "bg-transparent text-[#ff4e26] hover:underline p-0 border-none rounded-none h-auto",
          // Sizes
          size === "default" && "h-11 px-6 py-2.5 text-sm",
          size === "xs" && "h-8 px-3 text-xs",
          size === "sm" && "h-9 px-4 text-xs",
          size === "lg" && "h-13 px-8 text-base",
          size === "icon" && "h-11 w-11 p-0",
          size === "icon-xs" && "h-8 w-8 p-0",
          size === "icon-sm" && "h-9 w-9 p-0",
          size === "icon-lg" && "h-13 w-13 p-0",
          className
        )}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button }
