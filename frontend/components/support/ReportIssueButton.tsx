"use client"
import { useRouter } from "next/navigation"
import { Bug } from "lucide-react"
import { Button, type ButtonProps } from "@/components/ui/button"
import type { SupportCategoryValue } from "./supportCategories"

export function ReportIssueButton({
  defaultCategory = "bug",
  defaultMessage,
  generationId,
  children,
  className,
  variant = "outline",
  size = "sm"
}: {
  defaultCategory?: SupportCategoryValue
  defaultMessage?: string
  generationId?: string
  userEmail?: string
  title?: string
  description?: string
  children?: React.ReactNode
  className?: string
  variant?: ButtonProps["variant"]
  size?: ButtonProps["size"]
}) {
  const router = useRouter()
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={() => {
        const query = new URLSearchParams({
          category: defaultCategory,
          where_happened: window.location.pathname
        })
        if (defaultMessage) query.set("message", defaultMessage)
        if (generationId) query.set("generation_id", generationId)
        router.push(`/support/new?${query}`)
      }}
    >
      {children ?? (
        <>
          <Bug size={13} /> Report issue
        </>
      )}
    </Button>
  )
}
