"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useQuery, useMutation } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { Check } from "lucide-react"

function GithubGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg className="shrink-0 fill-current text-ink-soft" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  )
}
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { QueryError } from "@/components/profile/QueryError"

function isLinkedinUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (host === "linkedin.com" || host.endsWith(".linkedin.com"))
    )
  } catch {
    return false
  }
}

const schema = z.object({
  full_name: z.string().trim().min(1, "Name is required").max(100),
  subtitle: z.string().trim().min(1, "Please tell us what role you're targeting").max(120),
  location: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  linkedin_url: z
    .string()
    .trim()
    .max(2048)
    .refine((v) => v === "" || isLinkedinUrl(v), "Enter a valid LinkedIn URL"),
})

type FormData = z.infer<typeof schema>

type WelcomePrefill = {
  full_name: string | null
  subtitle: string | null
  location: string | null
  phone: string | null
  linkedin_url: string | null
}

interface WelcomeClientProps {
  initialName: string | null
  provider: string | null
}

export function WelcomeClient({ initialName, provider }: WelcomeClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { update } = useSession()
  const initialized = useRef(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const githubParam = searchParams.get("github")
  const githubConnected = githubParam === "connected"

  const { data: prefill, isLoading, isError, refetch } = useQuery<WelcomePrefill>({
    queryKey: ["welcome"],
    queryFn: async () => {
      const res = await fetch("/api/backend/account/welcome")
      if (!res.ok) throw new Error("Failed to load")
      return res.json()
    },
  })

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name: initialName ?? "",
      subtitle: "",
      location: "",
      phone: "",
      linkedin_url: "",
    },
  })
  const {
    register,
    handleSubmit,
    reset,
    getValues,
    trigger,
    formState: { errors },
  } = form

  useEffect(() => {
    if (prefill && !initialized.current) {
      reset({
        full_name: prefill.full_name ?? initialName ?? "",
        subtitle: prefill.subtitle ?? "",
        location: prefill.location ?? "",
        phone: prefill.phone ?? "",
        linkedin_url: prefill.linkedin_url ?? "",
      })
      initialized.current = true
    }
  }, [prefill, initialName, reset])

  const mutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/backend/account/welcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { detail?: unknown } | null
        throw new Error(
          typeof data?.detail === "string" && data.detail
            ? data.detail
            : "Something went wrong. Please try again.",
        )
      }
      return res.json()
    },
    onSuccess: async () => {
      await (update as unknown as (d: { needsWelcome: boolean }) => Promise<unknown>)({
        needsWelcome: false,
      })
      router.replace("/dashboard")
    },
    onError: (err) => {
      setServerError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
    },
  })

  const onSubmit = (data: FormData) => {
    setServerError(null)
    mutation.mutate({
      full_name: data.full_name,
      subtitle: data.subtitle,
      location: data.location || undefined,
      phone: data.phone || undefined,
      linkedin_url: data.linkedin_url || undefined,
    })
  }

  const onSkip = async () => {
    setServerError(null)
    const ok = await trigger("full_name")
    if (!ok) return
    mutation.mutate({ full_name: getValues("full_name"), skip: true })
  }

  if (isError) {
    return (
      <QueryError
        message="Could not load your details. Please try again."
        onRetry={() => {
          void refetch()
        }}
      />
    )
  }

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <div className="flex gap-2">
          <span className="loading-dot bg-[#ff4e26]" />
          <span className="loading-dot bg-yellow-400" />
          <span className="loading-dot bg-[#ff4e26]" />
        </div>
      </div>
    )
  }

  return (
    <div className="soft-card p-6 md:p-7">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <fieldset disabled={mutation.isPending} className="min-w-0 space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="full_name">Full Name</Label>
            <Input
              id="full_name"
              aria-invalid={!!errors.full_name}
              aria-describedby={errors.full_name ? "full_name-error" : undefined}
              {...register("full_name")}
            />
            {errors.full_name && (
              <p id="full_name-error" role="alert" className="text-xs font-bold text-red-600 dark:text-red-400">
                {errors.full_name.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="subtitle">What role are you targeting?</Label>
            <Input
              id="subtitle"
              placeholder="Backend engineer"
              aria-invalid={!!errors.subtitle}
              aria-describedby={errors.subtitle ? "subtitle-error" : undefined}
              {...register("subtitle")}
            />
            {errors.subtitle && (
              <p id="subtitle-error" role="alert" className="text-xs font-bold text-red-600 dark:text-red-400">
                {errors.subtitle.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="location">Location</Label>
              <Input id="location" placeholder="City, Country" {...register("location")} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" {...register("phone")} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="linkedin_url">LinkedIn URL</Label>
            <Input
              id="linkedin_url"
              aria-invalid={!!errors.linkedin_url}
              aria-describedby={errors.linkedin_url ? "linkedin_url-error" : undefined}
              {...register("linkedin_url")}
            />
            {errors.linkedin_url && (
              <p id="linkedin_url-error" role="alert" className="text-xs font-bold text-red-600 dark:text-red-400">
                {errors.linkedin_url.message}
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-paper px-4 py-3">
            <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
              <GithubGlyph size={16} />
              {provider === "github" ? (
                "Signed in with GitHub"
              ) : githubConnected ? (
                <span className="flex items-center gap-1.5">
                  <Check size={14} aria-hidden="true" className="text-emerald-600" />
                  GitHub connected
                </span>
              ) : (
                "Connect GitHub (optional)"
              )}
            </span>
            {provider !== "github" && !githubConnected && (
              <a
                href="/api/integrations/github/start?private=0&returnTo=/welcome"
                className="shrink-0 text-sm font-semibold text-ember underline hover:text-ink"
              >
                Connect
              </a>
            )}
          </div>

          {serverError && (
            <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
              {serverError}
            </p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" disabled={mutation.isPending} className="flex-1">
              {mutation.isPending ? "Saving..." : "Continue to dashboard"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void onSkip()}
              disabled={mutation.isPending}
              className="flex-1"
            >
              Skip for now
            </Button>
          </div>
        </fieldset>
      </form>
    </div>
  )
}
