import Link from "next/link"
import { redirect } from "next/navigation"
import { TryClient } from "./TryClient"
import { LoginModal } from "@/components/LoginModal"
import { auth } from "@/lib/auth"

export default async function TryPage() {
  const session = await auth()
  if (session) redirect("/dashboard")

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-white dark:bg-zinc-950 text-zinc-950 dark:text-white">
      {/* App nav */}
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-4 py-2.5 md:px-6">
        <Link href="/" className="resumer-mark px-2.5 py-1 text-base font-black md:text-lg">
          Resumer
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-zinc-500 dark:text-zinc-400 sm:block">
            Sign in to save your data and resume history
          </span>
          <LoginModal callbackUrl="/dashboard?importGuestDraft=1" />
        </div>
      </header>

      {/* Full-height two-panel builder */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <TryClient />
      </div>
    </main>
  )
}
