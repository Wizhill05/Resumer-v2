import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { AdminClient } from "./AdminClient"

export default async function AdminPage() {
  const session = await auth()
  if (!session) redirect("/")

  return (
    <main className="min-h-screen w-full bg-zinc-900 text-white flex flex-col">
      <AdminClient />
    </main>
  )
}
