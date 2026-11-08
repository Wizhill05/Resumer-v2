export type AdminTabId =
  | "overview"
  | "generations"
  | "timing"
  | "models"
  | "prompts"
  | "metrics"
  | "users"
  | "feedback"
  | "templates"
  | "storage"

export interface AdminNavItem {
  id: AdminTabId
  label: string
  icon: React.ComponentType<{ size?: number; className?: string }>
}

export const ADMIN_TAB_IDS: AdminTabId[] = [
  "overview",
  "generations",
  "timing",
  "models",
  "prompts",
  "metrics",
  "users",
  "feedback",
  "templates",
  "storage",
]

/** Old links used `?tab=analytics` for the home page. */
export function parseAdminTab(value: string | null | undefined): AdminTabId {
  if (value === "analytics") return "overview"
  return ADMIN_TAB_IDS.find((id) => id === value) ?? "overview"
}

export const ADMIN_TAB_INFO: Record<AdminTabId, { group: string; title: string; description: string }> = {
  overview: {
    group: "Overview & Operations",
    title: "Overview",
    description: "Audience, growth and pipeline health at a glance",
  },
  generations: {
    group: "Overview & Operations",
    title: "Generations",
    description: "Every résumé build with its status, logs and downloads",
  },
  timing: {
    group: "Overview & Operations",
    title: "Pipeline timing",
    description: "Model speed, node latency and the slowest builds",
  },
  users: {
    group: "Overview & Operations",
    title: "Users & limits",
    description: "Accounts, tiers and daily or monthly caps",
  },
  feedback: {
    group: "Overview & Operations",
    title: "Support & feedback",
    description: "Read issues, reply to users, and follow each conversation",
  },
  models: {
    group: "AI Engine & Infrastructure",
    title: "LLM endpoints",
    description: "Connect OpenAI-compatible APIs and route pipeline tasks",
  },
  prompts: {
    group: "AI Engine & Infrastructure",
    title: "Prompts",
    description: "Edit system and user prompts and test them",
  },
  metrics: {
    group: "AI Engine & Infrastructure",
    title: "LLM metrics",
    description: "Per-node call volume, tokens and errors",
  },
  templates: {
    group: "AI Engine & Infrastructure",
    title: "Template sandbox",
    description: "Render a template against any context",
  },
  storage: {
    group: "AI Engine & Infrastructure",
    title: "Storage",
    description: "Generated PDFs in Cloudflare R2",
  },
}
