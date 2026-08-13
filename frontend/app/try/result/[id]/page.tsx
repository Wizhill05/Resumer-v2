import Link from "next/link"
import { GuestResultClient } from "./GuestResultClient"
import { LoginModal } from "@/components/LoginModal"

export default async function GuestResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <main className="min-h-screen bg-[#fbfbf3] dark:bg-zinc-900 text-zinc-950 dark:text-white">
      <div className="mx-auto max-w-4xl px-5 py-5 md:px-8">
        <nav className="flex items-center justify-between border-b border-zinc-950/15 dark:border-white/15 pb-4">
          <Link href="/" className="resumer-mark px-3 py-1.5 text-xl font-black md:text-2xl">Resumer</Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-zinc-500 dark:text-zinc-400 sm:block">Sign in to keep this resume in your history</span>
            <LoginModal callbackUrl="/dashboard?importGuestDraft=1" />
          </div>
        </nav>
        <GuestResultClient id={id} />
      </div>
    </main>
  )
}
