import Link from "next/link"
import { GuestResultClient } from "./GuestResultClient"

export default async function GuestResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <main className="min-h-screen bg-[#fbfbf3] text-zinc-950">
      <div className="mx-auto max-w-4xl px-5 py-5 md:px-8">
        <nav className="flex items-center justify-between border-b border-zinc-950/15 pb-4">
          <Link href="/" className="resumer-mark px-3 py-1.5 text-xl font-black md:text-2xl">Resumer</Link>
          <Link href="/try" className="text-xs font-black uppercase tracking-[0.22em] text-zinc-500 hover:text-zinc-950">Try again</Link>
        </nav>
        <GuestResultClient id={id} />
      </div>
    </main>
  )
}
