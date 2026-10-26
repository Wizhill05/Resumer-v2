import { Nav } from "@/components/Nav"
import { Footer } from "@/components/Footer"

export function SupportShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="ph-no-capture flex min-h-screen flex-1 flex-col bg-[#fbfbf3] font-sans text-black dark:bg-zinc-900 dark:text-white">
      <Nav />
      <div className="page-wrap min-w-0 flex-1 py-6 md:py-8">
        <div className="mx-auto w-full max-w-4xl min-w-0">{children}</div>
      </div>
      <Footer />
    </main>
  )
}
