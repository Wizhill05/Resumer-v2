import Link from "next/link"
import { redirect } from "next/navigation"
import { TryClient } from "./TryClient"
import { LoginModal } from "@/components/LoginModal"
import { AuthErrorBanner } from "@/components/AuthErrorBanner"
import { auth } from "@/lib/auth"
import { FluidField } from "@/components/landing/FluidField"

export default async function TryPage() {
  const session = await auth()
  if (session) redirect("/dashboard")

  return (
    <main className="app-surface flex h-screen h-[100dvh] max-h-[100dvh] flex-col overflow-hidden">
      {/* App nav */}
      <header className="relative flex shrink-0 items-center justify-between overflow-hidden border-b border-line px-4 py-2.5 md:px-6">
        <FluidField variant="banner" sheen={false} />
        <Link href="/" className="resumer-mark relative text-base font-black tracking-tight text-[var(--fluid-ink)] md:text-lg">
          R<span className="normal-case">é</span>sumer
        </Link>
        <div className="relative flex items-center gap-3">
          <span className="hidden text-xs text-[var(--fluid-ink-soft)] sm:block dark:text-[#fff2ef]/80">
            Sign in to save your data and résumé history
          </span>
          <LoginModal callbackUrl="/dashboard?importGuestDraft=1" returnTo="/try" />
        </div>
      </header>

      <AuthErrorBanner inline />

      {/* Full-height two-panel builder */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <TryClient />
      </div>
    </main>
  )
}
