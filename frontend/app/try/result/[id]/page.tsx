import Link from "next/link"
import { GuestResultClient } from "./GuestResultClient"
import { LoginModal } from "@/components/LoginModal"

export default async function GuestResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <main className="min-h-screen bg-[#fbfbf3] text-zinc-950">
      <div className="mx-auto max-w-4xl px-5 py-5 md:px-8">
        <nav className="flex items-center justify-between border-b border-zinc-950/15 pb-4">
          <Link href="/" className="resumer-mark px-3 py-1.5 text-xl font-black md:text-2xl">Resumer</Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-zinc-500 sm:block">Sign in to keep this resume in your history</span>
            <LoginModal callbackUrl="/dashboard?importGuestDraft=1" />
          </div>
        </nav>
        <GuestResultClient id={id} />
      </div>
    </main>
  )
}
