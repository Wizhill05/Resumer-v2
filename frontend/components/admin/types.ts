export type AdminTabId =
  | "analytics"
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

export interface AdminNavGroup {
  group: string
  items: AdminNavItem[]
}

export const ADMIN_TAB_INFO: Record<AdminTabId, { group: string; title: string; description: string }> = {
  analytics: {
    group: "Overview & Operations",
    title: "Analytics & System Health",
    description: "Platform usage overview, latency distributions, and failure rates",
  },
  generations: {
    group: "Overview & Operations",
    title: "Live Generations",
    description: "Real-time resume generation trace inspector and execution status",
  },
  timing: {
    group: "Overview & Operations",
    title: "Pipeline Timing & Benchmarks",
    description: "Per-node latency waterfall, model execution speed, and bottleneck analysis",
  },
  users: {
    group: "Overview & Operations",
    title: "User Rate Limits & Caps",
    description: "Inspect registered accounts, override daily/monthly limits, and manage access",
  },
  feedback: {
    group: "Overview & Operations",
    title: "Support & Feedback Triage",
    description: "User bug reports, voice/screenshot attachments, and rating comments",
  },
  models: {
    group: "AI Engine & Infrastructure",
    title: "Model Providers & Routing",
    description: "Configure Pro and Free tier LLM providers, base URLs, and fallback models",
  },
  prompts: {
    group: "AI Engine & Infrastructure",
    title: "Prompt Manager & Playground",
    description: "Edit system and user prompts with real-time test case evaluation",
  },
  metrics: {
    group: "AI Engine & Infrastructure",
    title: "LLM Node Metrics",
    description: "Detailed per-node call volume, token counts, and error tracking",
  },
  templates: {
    group: "AI Engine & Infrastructure",
    title: "Template Sandbox",
    description: "Live Jinja2 template preview, context injector, and layout tester",
  },
  storage: {
    group: "AI Engine & Infrastructure",
    title: "Storage Explorer (Cloudflare R2)",
    description: "Inspect generated PDF artifacts, object keys, and direct download links",
  },
}
