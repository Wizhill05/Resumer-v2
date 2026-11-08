"use client"

import { useTheme } from "next-themes"

/**
 * Categorical slots 1-3 of the validated reference palette (blue, orange, aqua), stepped
 * separately for each surface. Tailwind drops unused custom properties from the stylesheet,
 * so colors resolve in JS from the active theme instead of CSS variables.
 */
const PALETTE = {
  light: { "viz-1": "#2a78d6", "viz-2": "#eb6834", "viz-3": "#1baf7a", "viz-grid": "#e4e4e7", "viz-axis": "#71717a" },
  dark: { "viz-1": "#3987e5", "viz-2": "#d95926", "viz-3": "#199e70", "viz-grid": "#3f3f46", "viz-axis": "#a1a1aa" },
} as const

export type VizToken = keyof (typeof PALETTE)["light"]

/** Turns a token such as `var(--viz-1)` into the hex for the current theme. */
export function useViz(): (token: string) => string {
  const { resolvedTheme } = useTheme()
  const palette = PALETTE[resolvedTheme === "dark" ? "dark" : "light"]
  return (token: string) => {
    const name = token.replace(/^var\(--/, "").replace(/\)$/, "") as VizToken
    return palette[name] ?? token
  }
}
