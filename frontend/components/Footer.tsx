import Link from "next/link"

export function Footer() {
  return (
    <footer className="mt-auto bg-zinc-950 px-5 py-12 text-white md:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 md:flex-row md:items-end md:justify-between">
        <div>
          <span className="resumer-mark px-3 py-1 text-xl font-black">Resumer</span>
          <p className="mt-5 max-w-sm text-sm font-semibold leading-relaxed text-zinc-400">
            Minimal resume workflow for people who want better drafts without more admin.
          </p>
        </div>
        <div className="flex flex-wrap gap-4 text-sm font-bold text-zinc-300">
          <Link href="/privacy" className="hover:text-white">Privacy Policy</Link>
          <a
            href="https://github.com/Wizhill05/resumer-v2"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white transition-colors"
          >
            Star on GitHub
          </a>
          <span className="text-zinc-600">Resumer V2</span>
        </div>
      </div>
    </footer>
  )
}
