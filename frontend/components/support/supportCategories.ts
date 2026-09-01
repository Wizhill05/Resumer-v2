"use client"

import { Bug, Sparkles, FileUp, FileText, User, Lightbulb, MessageCircle } from "lucide-react"

export type SupportCategoryValue = "bug" | "generation" | "import" | "template" | "account" | "feedback" | "other"

export type SupportCategory = {
  value: SupportCategoryValue
  label: string
  description: string
  icon: React.ElementType
}

export const SUPPORT_CATEGORIES: SupportCategory[] = [
  {
    value: "bug",
    label: "Bug Report",
    description: "Something broke or behaves incorrectly",
    icon: Bug,
  },
  {
    value: "generation",
    label: "Generation Issue",
    description: "Resume generation failed or output looks wrong",
    icon: Sparkles,
  },
  {
    value: "import",
    label: "Import & Extraction",
    description: "PDF or GitHub import did not extract correctly",
    icon: FileUp,
  },
  {
    value: "template",
    label: "Template & PDF",
    description: "Layout, fonts, or PDF export problem",
    icon: FileText,
  },
  {
    value: "account",
    label: "Account & Access",
    description: "Sign-in, profile, history, or access",
    icon: User,
  },
  {
    value: "feedback",
    label: "Feature Request",
    description: "Idea to make Resumer better",
    icon: Lightbulb,
  },
  {
    value: "other",
    label: "Other",
    description: "Anything else",
    icon: MessageCircle,
  },
]

export const SUPPORT_CATEGORY_MAP = new Map<SupportCategoryValue, SupportCategory>(
  SUPPORT_CATEGORIES.map((c) => [c.value, c])
)

export function getCategoryLabel(value: string | null | undefined): string {
  if (!value) return "Other"
  const found = SUPPORT_CATEGORY_MAP.get(value as SupportCategoryValue)
  return found ? found.label : value
}
