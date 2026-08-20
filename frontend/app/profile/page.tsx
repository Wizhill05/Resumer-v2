import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { ProfileClient } from "./ProfileClient"
import { Nav } from "@/components/Nav"
import { Footer } from "@/components/Footer"

export default async function ProfilePage() {
  const session = await auth()
  if (!session) redirect("/")

  return (
    <main className="flex-1 flex flex-col bg-[#fbfbf3] dark:bg-zinc-900 text-black dark:text-white">
      <Nav />

      <div className="page-wrap flex-1 space-y-4 md:space-y-5">
        <div className="page-header space-y-0.5">
          <h1 className="text-xl font-extrabold uppercase tracking-tight md:text-2xl">Your Profile</h1>
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 md:text-sm">
            Source material for your tailored resumes.
          </p>
        </div>

        <ProfileClient />
      </div>

      <Footer />
    </main>
  )
}
