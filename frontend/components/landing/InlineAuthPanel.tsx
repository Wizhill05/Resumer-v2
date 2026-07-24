"use client"

import Link from "next/link"
import { signInGithub, signInGoogle } from "@/app/actions"
import { ArrowRight } from "lucide-react"

interface InlineAuthPanelProps {
  callbackUrl?: string
  className?: string
}

export function InlineAuthPanel({
  callbackUrl = "/dashboard",
  className = "",
}: InlineAuthPanelProps) {
  return (
    <div
      className={`relative w-full max-w-sm border-3 border-black dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 shadow-[5px_5px_0px_#000000] dark:shadow-[5px_5px_0px_#ff4e26] transition-all ${className}`}
    >
      {/* OAuth Action Buttons */}
      <div className="flex flex-col gap-2.5">
        {/* GitHub Form */}
        <form action={signInGithub} className="w-full">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <button
            type="submit"
            className="group flex min-h-[46px] w-full items-center justify-center gap-3 border-2 border-black dark:border-zinc-600 bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 px-4 py-2.5 text-xs sm:text-sm font-black uppercase tracking-wide shadow-[3px_3px_0px_#ff4e26] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[5px_5px_0px_#ff4e26] active:translate-x-0 active:translate-y-0 active:shadow-[1px_1px_0px_#ff4e26]"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
              className="transition-transform group-hover:scale-110"
            >
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            Continue with GitHub
          </button>
        </form>

        {/* Google Form */}
        <form action={signInGoogle} className="w-full">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <button
            type="submit"
            className="group flex min-h-[46px] w-full items-center justify-center gap-3 border-2 border-black dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white px-4 py-2.5 text-xs sm:text-sm font-black uppercase tracking-wide shadow-[3px_3px_0px_#000000] dark:shadow-[3px_3px_0px_#3f3f46] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[5px_5px_0px_#000000] dark:hover:shadow-[5px_5px_0px_#ff4e26] active:translate-x-0 active:translate-y-0 active:shadow-[1px_1px_0px_#000000]"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="transition-transform group-hover:scale-110"
            >
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Continue with Google
          </button>
        </form>
      </div>

      {/* Guest Trial Divider */}
      <div className="relative my-3.5 text-center">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-dashed border-zinc-300 dark:border-zinc-700" />
        </div>
        <div className="relative inline-block bg-white dark:bg-zinc-900 px-2 text-[10px] font-extrabold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          OR NO LOGIN
        </div>
      </div>

      {/* Guest Link */}
      <Link
        href="/try"
        className="group flex min-h-[40px] w-full items-center justify-between border-2 border-black dark:border-zinc-700 bg-amber-300/30 dark:bg-zinc-800/80 px-3.5 py-2 text-xs font-black uppercase text-zinc-900 dark:text-amber-300 transition-colors hover:bg-amber-300/60 dark:hover:bg-zinc-800"
      >
        <span>Build Draft Without Account</span>
        <ArrowRight
          size={14}
          className="transition-transform group-hover:translate-x-1"
        />
      </Link>

      {/* Micro Footnote */}
      <div className="mt-3 text-center text-[10px] font-bold text-zinc-500 dark:text-zinc-400">
        5 free generations/day • Zero passwords
      </div>
    </div>
  )
}
