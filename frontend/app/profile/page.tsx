import { auth, signOut } from "@/lib/auth"
import { redirect } from "next/navigation"
import { ProfileClient } from "./ProfileClient"
import { Nav } from "@/components/Nav"
import { Button } from "@/components/ui/button"

export default async function ProfilePage() {
  const session = await auth()
  if (!session) redirect("/")

  return (
    <main className="min-h-screen bg-[#fbfbf3] text-black">
      <Nav />

      <div className="max-w-6xl mx-auto px-6 py-12 space-y-6">
        <div className="border-3 border-black bg-white p-6 shadow-[4px_4px_0px_#000000] space-y-2">
          <h1 className="text-3xl font-extrabold uppercase tracking-tight">Your Profile</h1>
          <p className="text-zinc-700 font-medium">
            Fill in your details. The AI pipeline uses this data to build tailored resumes.
          </p>
        </div>

        <ProfileClient />

        {/* Account section */}
        <div className="border-t border-gray-200 pt-10 mt-10">
          <h2 className="text-sm font-extrabold uppercase tracking-widest text-zinc-400 mb-4">Account</h2>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white border-2 border-black p-5 shadow-[2px_2px_0px_#000000]">
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
    </main>
  )
}
