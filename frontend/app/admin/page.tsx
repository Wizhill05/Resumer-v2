import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { Nav } from "@/components/Nav"
import { AdminClient } from "./AdminClient"

export default async function AdminPage() {
  const session = await auth()
  if (!session) redirect("/")

  return (
    <main className="min-h-screen flex flex-col bg-[#fbfbf3] dark:bg-zinc-900 text-black dark:text-white">
      <Nav />
      <div className="flex-1 flex flex-col">
        <AdminClient />
      </div>
    </main>
  )
}
