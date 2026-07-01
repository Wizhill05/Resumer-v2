export default function Loading() {
  return (
    <main className="min-h-screen app-bg p-4 text-black md:p-6">
      <div className="mx-auto max-w-6xl space-y-4 pixel-enter">
        <div className="flex items-center gap-3 py-2 text-xs font-extrabold uppercase tracking-widest text-zinc-500">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff4e26]" />
          Loading workspace
        </div>
        <div className="soft-skeleton h-24" />
        <div className="grid gap-3 md:grid-cols-3">
          <div className="soft-skeleton h-32" />
          <div className="soft-skeleton h-32" />
          <div className="soft-skeleton h-32" />
        </div>
      </div>
    </main>
  )
}
