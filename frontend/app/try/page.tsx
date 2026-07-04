import Link from "next/link"
import { TryClient } from "./TryClient"
import { LoginModal } from "@/components/LoginModal"

export default function TryPage() {
  return (
    <main className="flex h-screen flex-col overflow-hidden bg-white text-zinc-950">
      {/* App nav */}
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-4 py-2.5 md:px-6">
        <Link href="/" className="resumer-mark px-2.5 py-1 text-base font-black md:text-lg">
          Resumer
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-zinc-500 sm:block">
            Sign in to save your data and resume history
          </span>
          <LoginModal />
        </div>
      </header>

      {/* Full-height two-panel builder */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <TryClient />
      </div>
    </main>
  )
}
