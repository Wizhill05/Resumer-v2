import { auth } from "@/lib/auth"
import { Nav } from "@/components/Nav"
import { Footer } from "@/components/Footer"
import { SupportClient } from "./SupportClient"
import { SupportFaq } from "@/components/support/SupportFaq"

export default async function SupportPage() {
  const session = await auth()

  return (
    <main className="flex-1 flex flex-col bg-[#fbfbf3] dark:bg-zinc-900 text-black dark:text-white min-h-screen font-sans">
      <Nav />

      <div className="page-wrap flex-1 space-y-6 py-6 md:py-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-8 border-b border-zinc-200 dark:border-zinc-800 pb-5">
          <div className="page-header space-y-2 border-0 bg-transparent p-0 shadow-none dark:bg-transparent md:p-0">
            <p className="text-xs font-extrabold uppercase tracking-widest text-[#ff4e26]">Support</p>
            <h1 className="text-2xl font-black uppercase tracking-tight md:text-3xl">Need help?</h1>
            <p className="max-w-xl text-sm font-medium leading-relaxed text-zinc-600 dark:text-zinc-400">
              Found a bug or want a feature? Send a quick report. Add a screenshot or voice note if it helps.
            </p>
          </div>
          <p className="hidden md:block max-w-[280px] text-xs leading-relaxed text-zinc-500 dark:text-zinc-400 text-right">
            Reports are private. Attachments stay in your workspace and are only visible to admins.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.65fr_0.92fr] gap-6 lg:gap-8 items-start">
          <SupportClient userEmail={session?.user?.email ?? undefined} userName={session?.user?.name ?? undefined} />
          <aside className="lg:sticky lg:top-[68px]">
            <SupportFaq />
          </aside>
        </div>
      </div>

      <Footer />
    </main>
  )
}
