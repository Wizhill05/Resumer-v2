"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { signIn } from "next-auth/react"
import {
  startEmailRegistrationAction,
  verifyEmailRegistrationAction,
  resendEmailCodeAction,
  precheckEmailLoginAction,
} from "@/app/actions"
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
  const [notice, setNotice] = useState<string | null>(null)
  const [registerStep, setRegisterStep] = useState<1 | 2>(1)
  const [code, setCode] = useState("")
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [resendCountdown, setResendCountdown] = useState(0)
  const [resending, setResending] = useState(false)

  useEffect(() => {
    if (resendCountdown <= 0) return
    const id = setInterval(() => {
      setResendCountdown((c) => Math.max(0, c - 1))
    }, 1000)
    return () => clearInterval(id)
  }, [resendCountdown])

  const resetRegisterFlow = () => {
    setRegisterStep(1)
    setCode("")
    setPendingEmail(null)
    setResendCountdown(0)
    setResending(false)
  }

  const handleRegisterStep1 = async () => {
    const cleanName = name.trim()
    if (!cleanName) {
      setError("Please enter your full name.")
      return
    }

    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setError("Please enter a valid email address.")
      return
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters long.")
      return
    }

    setLoading(true)

    try {
      const startRes = await startEmailRegistrationAction({
        email: cleanEmail,
        password,
        name: cleanName,
      })

      if (!startRes.success) {
        setError(startRes.error || "Registration failed.")
        setLoading(false)
        return
      }

      setPendingEmail(startRes.email)
      setResendCountdown(startRes.resendAfter)
      setCode("")
      setRegisterStep(2)
      setLoading(false)
    } catch {
      setError("An unexpected error occurred. Please try again.")
      setLoading(false)
    }
  }

  const handleVerify = async () => {
    const targetEmail = pendingEmail ?? email.trim().toLowerCase()
    const cleanCode = code.replace(/\D/g, "")

    if (!/^\d{6}$/.test(cleanCode)) {
      setError("Please enter the 6-digit code.")
      return
    }

    setLoading(true)

    try {
      const verifyRes = await verifyEmailRegistrationAction({
        email: targetEmail,
        code: cleanCode,
        password,
      })

      if (!verifyRes.success) {
        setError(verifyRes.error || "Verification failed.")
        setLoading(false)
        return
      }

      // Establish NextAuth session with the password still in component state
      const signInRes = await signIn("credentials", {
        email: targetEmail,
        password,
        redirect: false,
        callbackUrl,
      })

      if (signInRes?.error) {
        // The account now exists and the pending sign-up is gone, so the
        // user cannot retry Verify. Hand off to Sign in instead.
        setMode("login")
        resetRegisterFlow()
        setEmail(targetEmail)
        setPassword("")
        setNotice("Your account is ready. Sign in with your email and password.")
        setLoading(false)
        return
      }

      // Redirect on success
      if (typeof window !== "undefined") {
        window.location.href = callbackUrl
      } else {
        router.push(callbackUrl)
      }
    } catch {
      setError("An unexpected error occurred. Please try again.")
      setLoading(false)
    }
  }

  const handleResend = async () => {
    if (resending || resendCountdown > 0) return

    const targetEmail = pendingEmail ?? email.trim().toLowerCase()
    setResending(true)

    try {
      const resendRes = await resendEmailCodeAction({ email: targetEmail })

      if (!resendRes.success) {
        setError(resendRes.error || "Could not resend the code.")
        setResending(false)
        return
      }

      setResendCountdown(resendRes.resendAfter)
      setError(null)
      setResending(false)
    } catch {
      setError("An unexpected error occurred. Please try again.")
      setResending(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setNotice(null)

    if (mode === "register") {
      if (registerStep === 1) {
        await handleRegisterStep1()
      } else {
        await handleVerify()
      }
      return
    }

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

  const isVerifyStep = mode === "register" && registerStep === 2

  return (
    <div className="w-full space-y-3.5">
      {/* Mode Switcher Tabs */}
      <div className="flex rounded-md border border-line bg-ink/5 p-0.5">
        <button
          type="button"
          onClick={() => {
            if (mode === "login") return
            setMode("login")
            setError(null)
            setNotice(null)
            resetRegisterFlow()
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
            if (mode === "register") return
            setMode("register")
            setError(null)
            setNotice(null)
            resetRegisterFlow()
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

      {/* Notice Callout */}
      {notice && !error && (
        <div
          role="status"
          className="flex items-start gap-2 border border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 p-2.5 text-xs font-bold text-emerald-700 dark:text-emerald-300 rounded-md"
        >
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-2.5">
        {isVerifyStep ? (
          <>
            <p className="text-xs font-semibold text-ink">
              We sent a 6-digit code to {pendingEmail ?? email.trim().toLowerCase()}.
            </p>

            <div>
              <label
                htmlFor="email-verification-code"
                className="block text-[11px] font-bold text-ink mb-1"
              >
                Verification Code
              </label>
              <input
                id="email-verification-code"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                autoFocus
                placeholder="123456"
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
                  <span>Verifying...</span>
                </>
              ) : (
                <span>Verify</span>
              )}
            </button>

            <button
              type="button"
              onClick={handleResend}
              disabled={resendCountdown > 0 || resending || loading}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 border border-line-strong bg-paper text-ink px-4 py-2.5 text-xs sm:text-sm font-bold transition-all cursor-pointer disabled:opacity-70 disabled:pointer-events-none rounded-md"
            >
              {resending ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Sending...</span>
                </>
              ) : resendCountdown > 0 ? (
                <span>Resend code ({resendCountdown}s)</span>
              ) : (
                <span>Resend code</span>
              )}
            </button>

            <div className="text-center pt-1">
              <button
                type="button"
                onClick={() => {
                  setRegisterStep(1)
                  setCode("")
                  setResendCountdown(0)
                  setError(null)
                }}
                className="text-xs font-bold text-ink-muted hover:text-ink dark:hover:text-white transition-colors cursor-pointer"
              >
                Use a different email
              </button>
            </div>
          </>
        ) : (
          <>
            {mode === "register" && (
              <div>
                <label htmlFor="email-auth-name" className="block text-[11px] font-bold text-ink mb-1">
                  Full Name
                </label>
                <input
                  id="email-auth-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Smith"
                  autoComplete="name"
                  disabled={loading}
                  className="w-full border border-line-strong bg-paper px-3 py-2 text-xs sm:text-sm font-semibold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-[#ff4e26] rounded-md"
                />
              </div>
            )}

            <div>
              <label htmlFor="email-auth-email" className="block text-[11px] font-bold text-ink mb-1">
                Email Address
              </label>
              <input
                id="email-auth-email"
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
              <label htmlFor="email-auth-password" className="block text-[11px] font-bold text-ink mb-1">
                Password
              </label>
              <input
                id="email-auth-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "register" ? "At least 8 characters" : "••••••••"}
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
                  <span>
                    {mode === "register" ? "Sending Code..." : "Signing In..."}
                  </span>
                </>
              ) : (
                <span>
                  {mode === "register" ? "Continue" : "Sign In with Email"}
                </span>
              )}
            </button>
          </>
        )}
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
