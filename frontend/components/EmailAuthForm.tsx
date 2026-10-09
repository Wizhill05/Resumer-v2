"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { signIn } from "next-auth/react"
import { registerEmailUserAction, precheckEmailLoginAction } from "@/app/actions"
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react"

interface EmailAuthFormProps {
  callbackUrl?: string
  onBack: () => void
  compact?: boolean
}

export function EmailAuthForm({
  callbackUrl = "/dashboard",
  onBack,
  compact = false,
}: EmailAuthFormProps) {
  const router = useRouter()
  const [mode, setMode] = useState<"login" | "register">("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setError("Please enter a valid email address.")
      return
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters long.")
      return
    }

    setLoading(true)

    try {
      if (mode === "register") {
        // 1. Register with backend
        const regRes = await registerEmailUserAction({
          email: cleanEmail,
          password,
          name: name.trim() || undefined,
        })

        if (!regRes.success) {
          setError(regRes.error || "Registration failed.")
          setLoading(false)
          return
        }
      } else {
        // 1. Verify credentials with backend
        const checkRes = await precheckEmailLoginAction({
          email: cleanEmail,
          password,
        })

        if (!checkRes.success) {
          setError(checkRes.error || "Invalid email or password.")
          setLoading(false)
          return
        }
      }

      // 2. Establish NextAuth session
      const signInRes = await signIn("credentials", {
        email: cleanEmail,
        password,
        redirect: false,
        callbackUrl,
      })

      if (signInRes?.error) {
        setError("Failed to sign in. Please verify your credentials.")
        setLoading(false)
        return
      }

      // Redirect on success
      if (typeof window !== "undefined") {
        window.location.href = callbackUrl
      } else {
        router.push(callbackUrl)
      }
    } catch (err) {
      console.error("Email auth error:", err)
      setError("An unexpected error occurred. Please try again.")
      setLoading(false)
    }
  }

  return (
    <div className="w-full space-y-3.5">
      {/* Mode Switcher Tabs */}
      <div className="flex border-2 border-black dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 p-0.5">
        <button
          type="button"
          onClick={() => {
            setMode("login")
            setError(null)
          }}
          className={`flex-1 py-1.5 text-xs font-black uppercase tracking-wider transition-colors cursor-pointer ${
            mode === "login"
              ? "bg-black text-white dark:bg-white dark:text-black shadow-[2px_2px_0px_#ff4e26]"
              : "text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
          }`}
        >
          Sign In
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("register")
            setError(null)
          }}
          className={`flex-1 py-1.5 text-xs font-black uppercase tracking-wider transition-colors cursor-pointer ${
            mode === "register"
              ? "bg-black text-white dark:bg-white dark:text-black shadow-[2px_2px_0px_#ff4e26]"
              : "text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
          }`}
        >
          Create Account
        </button>
      </div>

      {/* Error Callout */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 border-2 border-red-500 bg-red-50 dark:bg-red-950/40 p-2.5 text-xs font-bold text-red-700 dark:text-red-300"
        >
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-2.5">
        {mode === "register" && (
          <div>
            <label className="block text-[11px] font-black uppercase tracking-wide text-zinc-700 dark:text-zinc-300 mb-1">
              Full Name (Optional)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex Smith"
              disabled={loading}
              className="w-full border-2 border-black dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-xs sm:text-sm font-semibold text-black dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#ff4e26]"
            />
          </div>
        )}

        <div>
          <label className="block text-[11px] font-black uppercase tracking-wide text-zinc-700 dark:text-zinc-300 mb-1">
            Email Address
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            disabled={loading}
            className="w-full border-2 border-black dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-xs sm:text-sm font-semibold text-black dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#ff4e26]"
          />
        </div>

        <div>
          <label className="block text-[11px] font-black uppercase tracking-wide text-zinc-700 dark:text-zinc-300 mb-1">
            Password
          </label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "register" ? "At least 6 characters" : "••••••••"}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            disabled={loading}
            className="w-full border-2 border-black dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-xs sm:text-sm font-semibold text-black dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#ff4e26]"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className={`group flex min-h-[44px] w-full items-center justify-center gap-2 border-2 border-black bg-[#ff4e26] text-white px-4 py-2.5 text-xs sm:text-sm font-black uppercase tracking-wide shadow-[3px_3px_0px_#000000] dark:shadow-[3px_3px_0px_#3f3f46] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[5px_5px_0px_#000000] active:translate-x-0 active:translate-y-0 active:shadow-[1px_1px_0px_#000000] cursor-pointer disabled:opacity-70 disabled:pointer-events-none ${
            compact ? "min-h-[40px] py-2" : ""
          }`}
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              <span>{mode === "register" ? "Creating Account..." : "Signing In..."}</span>
            </>
          ) : (
            <span>{mode === "register" ? "Create Account & Sign In" : "Sign In with Email"}</span>
          )}
        </button>
      </form>

      {/* Back to social login */}
      <div className="text-center pt-1">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white transition-colors cursor-pointer"
        >
          <ArrowLeft size={13} />
          <span>Back to Google / GitHub</span>
        </button>
      </div>
    </div>
  )
}
