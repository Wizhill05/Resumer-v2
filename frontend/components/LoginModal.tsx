"use client"

import { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { signInGithub, signInGoogle } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { X } from "lucide-react"

export function LoginModal() {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  // Lock body scroll when open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : ""
    return () => { document.body.style.overflow = "" }
  }, [open])

  return (
    <>
      <Button
        variant="default"
        size="sm"
        onClick={() => setOpen(true)}
        className="shadow-[3px_3px_0_#18181b] ring-2 ring-[#ff4e26]/20 hover:ring-[#ff4e26]/35"
      >
        Login
      </Button>

      {open && mounted && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Login"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />

          {/* Modal */}
          <div className="relative z-10 w-full max-w-lg border-3 border-black bg-white p-6 shadow-[8px_8px_0px_#000000] sm:p-8 md:p-10">
            {/* Close */}
            <button
              onClick={() => setOpen(false)}
              className="absolute top-4 right-4 p-1 hover:bg-zinc-100 rounded transition-colors"
              aria-label="Close"
            >
              <X size={18} />
            </button>

            {/* Header */}
            <div className="mb-8">
              <div className="resumer-mark px-3 py-1 text-lg font-black mb-4">
                <span className="text-xl font-extrabold uppercase tracking-tight">Resumer</span>
              </div>
              <h2 className="text-3xl font-extrabold uppercase leading-tight tracking-[-0.03em] md:text-4xl">
                Sign in to continue
              </h2>
              <p className="mt-2 text-base font-semibold text-zinc-500">
                Choose a provider to get started
              </p>
            </div>

            {/* Login options */}
            <div className="flex flex-col gap-3">
              <form action={signInGithub}>
                <button
                  type="submit"
                  className="flex min-h-14 w-full items-center gap-3 border-2 border-black bg-white px-5 py-4 text-left text-base font-bold transition-colors hover:bg-zinc-50 active:bg-zinc-100"
                >
                  {/* GitHub icon */}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                  </svg>
                  Continue with GitHub
                </button>
              </form>

              <form action={signInGoogle}>
                <button
                  type="submit"
                  className="flex min-h-14 w-full items-center gap-3 border-2 border-black bg-white px-5 py-4 text-left text-base font-bold transition-colors hover:bg-zinc-50 active:bg-zinc-100"
                >
                  {/* Google icon */}
                  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Continue with Google
                </button>
              </form>
            </div>

            <p className="mt-6 text-center text-sm font-semibold text-zinc-400">
              Free beta. 5 generations per day.
            </p>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
