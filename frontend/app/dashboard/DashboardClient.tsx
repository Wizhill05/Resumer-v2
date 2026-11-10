"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { ArrowUpRight, History, UserRound } from "lucide-react"
import { importGuestIntoAccount } from "@/lib/guest-import"
import { useHistorySummary } from "@/components/useGenerationStats"
import { GettingStarted } from "@/components/onboarding/GettingStarted"
import { useOnboardingSteps } from "@/lib/onboarding"

type Profile = {
  full_name?: string
  email?: string
}

type Entry = { id: string }


async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load ${url}`)
  return res.json()
}

export function DashboardClient() {
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const { data: profile, isLoading: loadingProfile } = useQuery<Profile>({
    queryKey: ["profile"],
    queryFn: () => getJson("/api/backend/profile"),
  })
  const { data: experiences = [], isLoading: loadingExp } = useQuery<Entry[]>({
    queryKey: ["experiences"],
    queryFn: () => getJson("/api/backend/profile/experiences"),
  })
  const { data: projects = [], isLoading: loadingProjects } = useQuery<Entry[]>({
    queryKey: ["projects"],
    queryFn: () => getJson("/api/backend/profile/projects"),
  })
  const { data: education = [], isLoading: loadingEducation } = useQuery<Entry[]>({
    queryKey: ["education"],
    queryFn: () => getJson("/api/backend/profile/education"),
  })
  const { data: extracurriculars = [], isLoading: loadingExtra } = useQuery<Entry[]>({
    queryKey: ["extracurriculars"],
    queryFn: () => getJson("/api/backend/profile/extracurriculars"),
  })

  // History only needs aggregates (GET /generate/summary), but it still must
  // not block the page or render as "0 résumés" while it is in flight.
  const {
    data: history,
    isPending: loadingHistory,
    isError: historyFailed,
  } = useHistorySummary()

  const onboarding = useOnboardingSteps()

  const isLoading = loadingProfile || loadingExp || loadingProjects || loadingEducation || loadingExtra
  const missing = [
    !profile?.full_name || !profile?.email ? "Basic info" : null,
    experiences.length < 1 ? "Experience" : null,
    projects.length < 1 ? "Project" : null,
    education.length < 1 ? "Education" : null,
    extracurriculars.length < 1 ? "Activity" : null,
  ].filter(Boolean) as string[]
  const profileComplete = !isLoading && missing.length === 0

  // Signed in from /try: bring the trial résumés and details into the account.
  // Brand-new accounts already did this on /welcome; this covers existing ones.
  const importRequested = searchParams.get("importGuestDraft") === "1"
  useEffect(() => {
    if (!importRequested) return
    let cancelled = false
    importGuestIntoAccount()
      .then(async ({ claimed, imported, ok }) => {
        if (cancelled) return
        await queryClient.invalidateQueries()
        if (!ok) setImportMessage("Some trial data could not import. Check Profile.")
        else if (imported || claimed > 0) setImportMessage("Your trial résumés and details are now in your account.")
      })
      .catch(() => { if (!cancelled) setImportMessage("Trial data import failed. Check Profile.") })
    return () => { cancelled = true }
  }, [importRequested, queryClient])

  if (isLoading) {
    return (
      <div className="space-y-5">
        <div className="grid gap-5 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => <div key={i} className="soft-skeleton h-44" />)}
        </div>
      </div>
    )
  }

  const latestDate = history?.latest_created_at
    ? new Date(history.latest_created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null

  const tiles = [
    {
      key: "profile",
      title: "Profile",
      desc: "Source material for every résumé.",
      href: "/profile",
      icon: UserRound,
      stats: [
        [experiences.length, "experience"],
        [projects.length, "projects"],
        [education.length, "education"],
        [extracurriculars.length, "activities"],
      ] as [number | string, string][],
    },
    {
      key: "history",
      title: "History",
      desc: "Past builds, previews and PDFs.",
      href: "/dashboard/history",
      icon: History,
      stats: (history
        ? [
            [history.total, history.total === 1 ? "résumé" : "résumés"],
            ...(latestDate ? [[latestDate, "latest"] as [string, string]] : []),
            ...(history.latest_company ? [[history.latest_company, "company"] as [string, string]] : []),
          ]
        : [["-", "résumés"]]) as [number | string, string][],
    },
  ]

  return (
    <div className="space-y-6 pixel-enter sm:space-y-8">
      {importMessage && (
        <div className="rounded-md border border-ok/30 bg-ok/10 p-4 text-sm font-semibold text-ok">
          {importMessage}
        </div>
      )}

      <GettingStarted />

      {/* Once the guide is hidden or done, keep the plain reminder for gaps. */}
      {!profileComplete && !onboarding.isLoading && !onboarding.active && (
        <section className="soft-card flex flex-col gap-4 p-5 sm:p-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-ink md:text-xl">Finish your profile first</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Missing: {missing.join(", ")}. Upload old résumés or paste GitHub links to fill it faster.
            </p>
          </div>
          <Link href="/onboarding" className="w-full md:w-auto">
            <Button size="lg" className="w-full md:w-auto">Finish profile</Button>
          </Link>
        </section>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        {tiles.map((tile) => {
          const Icon = tile.icon
          return (
            <Link key={tile.key} href={tile.href} className="group block rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember">
              <section className="soft-card soft-hover flex h-full flex-col gap-5 p-6 sm:p-7">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-ember-tint text-ember">
                      <Icon size={18} aria-hidden="true" />
                    </span>
                    <h2 className="text-xl font-bold tracking-tight text-ink">{tile.title}</h2>
                    <p className="mt-1 text-sm text-ink-muted">{tile.desc}</p>
                  </div>
                  <ArrowUpRight size={18} aria-hidden="true" className="text-ink-faint transition-transform group-hover:text-ember" />
                </div>
                <dl className="mt-auto grid grid-flow-col auto-cols-fr border-t border-line pt-4">
                  {tile.stats.map(([value, label], i) => (
                    <div key={label} className={`min-w-0 ${i ? "border-l border-line pl-4" : ""} pr-2`}>
                      <dd className="truncate text-xl font-semibold tracking-tight text-ink">
                        {tile.key === "history" && loadingHistory ? (
                          <span className="soft-skeleton inline-block h-6 w-10 align-middle" role="status" aria-label="Loading résumés" />
                        ) : (
                          value
                        )}
                      </dd>
                      <dt className="text-xs text-ink-muted">
                        {tile.key === "history" && historyFailed ? "couldn’t load" : label}
                      </dt>
                    </div>
                  ))}
                </dl>
              </section>
            </Link>
          )
        })}
      </div>

      <section className="grid gap-6 border-t border-line pt-7 md:grid-cols-[17rem_1fr_1fr_1fr] md:gap-0">
        <div className="md:pr-6">
          <h2 className="text-lg font-bold tracking-tight text-ink">How a build runs</h2>
          <p className="mt-1.5 text-sm text-ink-muted">Usually 5–10 minutes. It&apos;s safe to close the tab once it starts.</p>
        </div>
        {[
          ["01", "Paste the job", "The full post, requirements included."],
          ["02", "Pick a mode", "Proper, LARP or Super LARP."],
          ["03", "Get the PDF", "We email you when it's ready."],
        ].map(([n, title, desc]) => (
          <div key={n} className="flex gap-3.5 md:pl-6">
            <span className="text-4xl font-light leading-none tracking-tight text-ink/40">{n}</span>
            <div className="border-l border-line pl-3.5 pt-1">
              <h3 className="text-sm font-semibold text-ink">{title}</h3>
              <p className="mt-0.5 text-sm text-ink-muted">{desc}</p>
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}
