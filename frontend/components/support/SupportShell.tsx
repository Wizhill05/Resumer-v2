import type { ReactNode } from "react"
import { Nav } from "@/components/Nav"
import { Footer } from "@/components/Footer"
import { PageHero } from "@/components/PageHero"

interface SupportShellProps {
  children: ReactNode
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  back?: { href: string; label: string }
  signedIn?: boolean
}

export function SupportShell({ children, title, subtitle, actions, back, signedIn }: SupportShellProps) {
  return (
    <main className="ph-no-capture app-surface flex min-h-screen flex-1 flex-col font-sans">
      <Nav signedIn={signedIn} />
      {title && <PageHero title={title} subtitle={subtitle} actions={actions} back={back} />}
      <div className="page-wrap min-w-0 flex-1">
        <div className="min-w-0">{children}</div>
      </div>
      <Footer />
    </main>
  )
}
