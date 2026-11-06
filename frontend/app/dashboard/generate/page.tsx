import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { GenerateClient } from "./GenerateClient"
import { Nav } from "@/components/Nav"
import { Footer } from "@/components/Footer"

export default async function GeneratePage() {
  const session = await auth()
  if (!session) redirect("/")

  return (
    <main className="flex-1 flex flex-col bg-[#fbfbf3] dark:bg-zinc-900 text-black dark:text-white">
      <Nav />

      <div className="page-wrap flex-1 max-w-4xl max-md:w-[calc(100%_-_2.5rem)] space-y-4 md:space-y-5">
        <GenerateClient />
      </div>

      <Footer />
    </main>
  )
}
