"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { SessionProvider } from "next-auth/react"
import { ThemeProvider } from "next-themes"
import { useState } from "react"
import { PostHogProvider } from "@/components/providers/PostHogProvider"
import { DynamicAnnouncementModal } from "@/components/announcements/DynamicAnnouncementModal"

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  }))

  return (
    <SessionProvider>
      <PostHogProvider>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <QueryClientProvider client={queryClient}>
            <DynamicAnnouncementModal />
            {children}
          </QueryClientProvider>
        </ThemeProvider>
      </PostHogProvider>
    </SessionProvider>
  )
}
