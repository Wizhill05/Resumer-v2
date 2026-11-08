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
      <div className="flex rounded-md border border-line bg-ink/5 p-0.5">
        <button
          type="button"
          onClick={() => {
            setMode("login")
            setError(null)
          }}
          className={`flex-1 rounded-[4px] py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
            mode === "login"
              ? "bg-paper text-ink shadow-soft ring-1 ring-line"
              : "text-ink-muted hover:text-ink dark:hover:text-white"
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("register")
            setError(null)
          }}
          className={`flex-1 rounded-[4px] py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
            mode === "register"
              ? "bg-paper text-ink shadow-soft ring-1 ring-line"
              : "text-ink-muted hover:text-ink dark:hover:text-white"
          }`}
        >
          Create account
        </button>
      </div>

      {/* Error Callout */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 border border-red-500 bg-red-50 dark:bg-red-950/40 p-2.5 text-xs font-bold text-red-700 dark:text-red-300 rounded-md"
        >
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-2.5">
        {mode === "register" && (
          <div>
            <label className="block text-[11px] font-bold text-ink mb-1">
              Full Name (Optional)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex Smith"
              disabled={loading}
              className="w-full border border-line-strong bg-paper px-3 py-2 text-xs sm:text-sm font-semibold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-[#ff4e26] rounded-md"
            />
          </div>
        )}

        <div>
          <label className="block text-[11px] font-bold text-ink mb-1">
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
            className="w-full border border-line-strong bg-paper px-3 py-2 text-xs sm:text-sm font-semibold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-[#ff4e26] rounded-md"
          />
        </div>

        <div>
          <label className="block text-[11px] font-bold text-ink mb-1">
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
            className="w-full border border-line-strong bg-paper px-3 py-2 text-xs sm:text-sm font-semibold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-[#ff4e26] rounded-md"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className={`group flex min-h-[44px] w-full items-center justify-center gap-2 border border-line-strong bg-[#ff4e26] text-white px-4 py-2.5 text-xs sm:text-sm font-bold transition-all cursor-pointer disabled:opacity-70 disabled:pointer-events-none shadow-soft rounded-md ${
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
          className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-muted hover:text-ink dark:hover:text-white transition-colors cursor-pointer"
        >
          <ArrowLeft size={13} />
          <span>Back to Google / GitHub</span>
        </button>
      </div>
    </div>
  )
}
