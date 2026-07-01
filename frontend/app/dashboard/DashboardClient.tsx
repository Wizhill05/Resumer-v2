"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Clock, UserRound } from "lucide-react"

type Profile = {
  full_name?: string
  email?: string
}

type Entry = { id: string }

const sections = [
  { key: "profile", label: "Profile Section", href: "/profile", icon: UserRound, desc: "Edit info, experience, projects, education, and activities." },
  { key: "history", label: "History Section", href: "/dashboard/history", icon: Clock, desc: "Open past generations and downloads." },
]

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load ${url}`)
  return res.json()
}

export function DashboardClient() {
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

  const isLoading = loadingProfile || loadingExp || loadingProjects || loadingEducation || loadingExtra
  const missing = [
    !profile?.full_name || !profile?.email ? "Basic info" : null,
    experiences.length < 1 ? "Experience" : null,
    projects.length < 1 ? "Project" : null,
    education.length < 1 ? "Education" : null,
    extracurriculars.length < 1 ? "Activity" : null,
  ].filter(Boolean) as string[]
  const profileComplete = !isLoading && missing.length === 0

  if (isLoading) {
    return (
      <div className="space-y-4 md:space-y-5">
        <div className="soft-skeleton h-28" />
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => <div key={i} className="soft-skeleton h-28" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 md:space-y-5 pixel-enter">
      {!profileComplete && (
        <section className="sticky top-3 z-10 panel-strong overflow-hidden bg-white">
          <div className="h-1.5 bg-[#ff4e26]" />
          <div className="grid gap-4 p-4 md:grid-cols-[1fr_auto] md:items-center md:p-5">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-widest text-[#ff4e26]">Profile needed</p>
              <h2 className="text-xl font-extrabold uppercase tracking-tight">Add source material first</h2>
              <p className="mt-1 text-sm font-semibold leading-relaxed text-zinc-600">
                Missing: {missing.join(", ")}. Add at least one entry in each section so generator has material.
              </p>
            </div>
            <Link href="/profile" className="w-full md:w-auto">
              <Button size="lg" className="w-full md:w-auto">Complete Profile</Button>
            </Link>
          </div>
        </section>
      )}

      {profileComplete && (
        <section className="panel-strong overflow-hidden bg-white">
          <div className="h-1.5 bg-[#ff4e26]" />
          <div className="grid gap-4 p-4 md:grid-cols-[1fr_auto] md:items-center md:p-6">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-widest text-[#ff4e26]">Profile ready</p>
              <h2 className="text-2xl font-extrabold uppercase tracking-tight md:text-4xl">Generate resume now</h2>
              <p className="mt-1 max-w-2xl text-sm font-semibold leading-relaxed text-zinc-600">
                You have source material in every profile section. Paste job post and choose focus next.
              </p>
            </div>
            <Link href="/dashboard/generate" className="w-full md:w-auto">
              <Button size="lg" className="w-full md:w-auto text-base">Generate Resume</Button>
            </Link>
          </div>
        </section>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {sections.map((section) => {
          const Icon = section.icon
          return (
            <Link key={section.key} href={section.href} className="group block">
              <section className="compact-card h-full p-5">
                <div className="mb-3 flex h-10 w-10 items-center justify-center border border-zinc-900 bg-white text-black group-hover:bg-zinc-950 group-hover:text-white">
                  <Icon size={18} />
                </div>
                <h3 className="text-base font-extrabold uppercase tracking-tight">{section.label}</h3>
                <p className="mt-2 text-sm font-semibold leading-relaxed text-zinc-600">
                  {section.desc}
                </p>
              </section>
            </Link>
          )
        })}
      </div>

      <div className="panel flex flex-col gap-2 p-3 text-xs font-bold text-zinc-600 md:flex-row md:items-center md:justify-between md:px-4">
        <span className="uppercase tracking-wider text-zinc-400">Typical generation time</span>
        <span>5-10 minutes. Safe to close tab after starting.</span>
      </div>
    </div>
  )
}
