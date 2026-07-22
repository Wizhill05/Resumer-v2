import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { Nav } from "@/components/Nav"
import { Footer } from "@/components/Footer"
import { ProfileClient } from "@/app/profile/ProfileClient"

export default async function OnboardingPage() {
  const session = await auth()
  if (!session) redirect("/")

  return (
    <main className="flex-1 flex flex-col app-bg text-black dark:text-white">
      <Nav />
      <div className="page-wrap flex-1 space-y-4 md:space-y-5">
        <div className="page-header space-y-1">
          <p className="text-xs font-extrabold uppercase tracking-widest text-[#ff4e26]">Onboarding</p>
          <h1 className="text-2xl font-extrabold uppercase tracking-tight md:text-3xl">Build profile fast</h1>
          <p className="max-w-2xl text-sm font-medium leading-relaxed text-zinc-600">
            Import old resumes, autofill GitHub projects, then patch missing fields before generating.
          </p>
        </div>
        <ProfileClient />
      </div>
      <Footer />
    </main>
  )
}
