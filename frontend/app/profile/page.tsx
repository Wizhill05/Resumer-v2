import { auth, signOut } from "@/lib/auth"
import { redirect } from "next/navigation"
import { ProfileClient } from "./ProfileClient"
import { Nav } from "@/components/Nav"
import { Button } from "@/components/ui/button"
import { Footer } from "@/components/Footer"

export default async function ProfilePage() {
  const session = await auth()
  if (!session) redirect("/")

  return (
    <main className="min-h-screen flex flex-col app-bg text-black">
      <Nav />

      <div className="page-wrap flex-1 space-y-4 md:space-y-5">
        <div className="page-header space-y-1">
          <p className="text-xs font-extrabold uppercase tracking-widest text-[#ff4e26]">Step 1</p>
          <h1 className="text-2xl font-extrabold uppercase tracking-tight md:text-3xl">Your Profile</h1>
          <p className="max-w-2xl text-sm font-medium leading-relaxed text-zinc-600">
            This is the source material for every generated resume. Projects and experience also unlock focus options.
          </p>
        </div>

        <ProfileClient />

        {/* Account section */}
        <div className="pt-2">
          <h2 className="mb-3 text-xs font-extrabold uppercase tracking-widest text-zinc-400">Account</h2>
          <div className="panel flex flex-col items-start justify-between gap-3 p-4 sm:flex-row sm:items-center">
            <div>
              <p className="font-bold text-sm">{session.user?.name ?? "User"}</p>
              <p className="text-xs text-zinc-500">{session.user?.email ?? ""}</p>
            </div>
            <form
              action={async () => {
                "use server"
                await signOut({ redirectTo: "/" })
              }}
            >
              <Button type="submit" variant="outline" size="sm" className="text-red-600 hover:bg-red-50">
                Sign Out
              </Button>
            </form>
          </div>
        </div>
      </div>

      <Footer />
    </main>
  )
}
