"use client"

import { useState } from "react"
import { LogOut, Copy, Check } from "lucide-react"
import { signOutAction } from "@/app/actions"

interface AccountClientProps {
  name: string | null
  email: string | null
  image: string | null
  provider: string | null
}

function initials(name: string | null, email: string | null) {
  if (name?.trim()) {
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("")
  }
  if (email?.trim()) return email.trim()[0]?.toUpperCase() ?? "?"
  return "?"
}

function providerLabel(provider: string | null) {
  if (provider === "github") return "GitHub"
  if (provider === "google") return "Google"
  if (provider) return provider[0].toUpperCase() + provider.slice(1)
  return "OAuth"
}

export function AccountClient({ name, email, image, provider }: AccountClientProps) {
  const [copied, setCopied] = useState(false)

  const copyEmail = async () => {
    if (!email) return
    try {
      await navigator.clipboard.writeText(email)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return (
    <div className="max-w-xl">
      {/* Identity card */}
      <section className="border-2 border-black bg-white p-5 shadow-[5px_5px_0px_#000000] dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-[5px_5px_0px_#3f3f46]">
        <div className="flex items-center gap-4">
          {image ? (
            <img
              src={image}
              alt=""
              width={56}
              height={56}
              referrerPolicy="no-referrer"
              className="h-14 w-14 rounded-full border border-zinc-200 object-cover dark:border-zinc-700"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-[#ff4e26] text-lg font-black text-white"
            >
              {initials(name, email)}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="truncate text-lg font-extrabold tracking-tight">
              {name ?? "Account"}
            </h2>
            <span className="mt-1 inline-block border border-zinc-300 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wide text-zinc-500 uppercase dark:border-zinc-700 dark:text-zinc-400">
              {providerLabel(provider)}
            </span>
          </div>
        </div>

        <div className="mt-4 border-t border-dashed border-zinc-300 pt-4 dark:border-zinc-700">
          <p className="font-mono text-[10px] font-bold tracking-widest text-zinc-500 uppercase dark:text-zinc-400">
            Login email
          </p>
          {email ? (
            <div className="mt-1 flex items-start gap-2">
              <p className="min-w-0 flex-1 text-sm font-bold break-all select-all">
                {email}
              </p>
              <button
                type="button"
                onClick={copyEmail}
                aria-label="Copy email"
                className="shrink-0 cursor-pointer border border-zinc-300 p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-black dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-white"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          ) : (
            <p className="mt-1 text-sm font-semibold text-zinc-500">
              No email on file for this login.
            </p>
          )}
        </div>

        <form action={signOutAction} className="mt-5">
          <button
            type="submit"
            className="flex w-full cursor-pointer items-center justify-center gap-2 border-2 border-red-600 bg-red-50 px-4 py-2.5 text-xs font-black tracking-wider text-red-700 uppercase transition-colors hover:bg-red-100 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/60"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </form>
      </section>
    </div>
  )
}
