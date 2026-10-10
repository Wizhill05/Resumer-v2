export interface AnnouncementConfig {
  id: string
  enabled: boolean
  title: string
  message: string
  lockDurationSeconds: number
  targetRoutes: string[]
  severity?: "critical" | "warning" | "info"
}

export const CURRENT_ANNOUNCEMENT: AnnouncementConfig = {
  id: "db-refresh-notice-2026-09-v2",
  enabled: false,
  title: "Important: Database Refreshed Temporarily",
  message:
    "Due to unforeseen circumstances, the database has been refreshed temporarily. You might have to enter your data again. Don't worry. All the updates to the database will be merged. You will get access to the old database, old résumés, and old profile in a few days' time. Sorry for the inconvenience.",
  lockDurationSeconds: 10,
  targetRoutes: [
    "/",
    "/dashboard",
    "/dashboard/generate",
    "/dashboard/history",
    "/profile",
    "/try",
  ],
  severity: "critical",
}
