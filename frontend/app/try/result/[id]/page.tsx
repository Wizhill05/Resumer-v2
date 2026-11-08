import Link from "next/link"
import { GuestResultClient } from "./GuestResultClient"
import { LoginModal } from "@/components/LoginModal"

export default async function GuestResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <main className="min-h-screen bg-app text-ink">
      <div className="mx-auto max-w-4xl px-5 py-5 md:px-8">
        <nav className="flex items-center justify-between border-b border-line pb-4">
          <Link href="/" className="resumer-mark px-3 py-1.5 text-xl font-bold md:text-2xl">R<span className="normal-case">é</span>sumer</Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-ink-muted sm:block">Sign in to keep this résumé in your history</span>
            <LoginModal callbackUrl="/dashboard?importGuestDraft=1" />
          </div>
        </nav>
        <GuestResultClient id={id} />
      </div>
    </main>
  )
}
