import { auth } from "@/lib/auth"
import { Nav } from "@/components/Nav"
import { Footer } from "@/components/Footer"
import { SupportClient } from "./SupportClient"

export default async function SupportPage() {
  const session = await auth()

  return (
    <main className="flex-1 flex flex-col bg-[#fbfbf3] dark:bg-zinc-900 text-black dark:text-white min-h-screen font-sans">
      <Nav />

      <div className="page-wrap flex-1 space-y-4 md:space-y-6 py-6 md:py-8">
        <div className="page-header space-y-1">
          <p className="text-xs font-extrabold uppercase tracking-widest text-[#ff4e26]">Help & Support</p>
          <h1 className="text-2xl font-extrabold uppercase tracking-tight md:text-3xl">Report an Issue or Feedback</h1>
          <p className="max-w-2xl text-sm font-medium leading-relaxed text-zinc-600 dark:text-zinc-400">
            Have a question, encountered a bug, or want to record a voice message? Send your feedback directly to our team.
          </p>
        </div>

        <SupportClient userEmail={session?.user?.email ?? undefined} userName={session?.user?.name ?? undefined} />
      </div>

      <Footer />
    </main>
  )
}
