import { auth, signOut } from "@/lib/auth"
import { redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import Link from "next/link"

export default async function DashboardPage() {
  const session = await auth()
  if (!session) redirect("/")

  const firstName = session.user?.name?.split(" ")[0] ?? "there"

  return (
    <main className="min-h-screen texture-bg text-black">
      {/* Nav */}
      <nav className="border-b-3 border-black px-6 py-4 bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link href="/dashboard" className="text-xl font-extrabold uppercase border-2 border-black bg-yellow-400 px-3 py-1 shadow-[2px_2px_0px_#000000]">
            Resumer
          </Link>
          <div className="flex items-center gap-4 text-sm font-bold">
            <Link href="/dashboard" className="text-[#ff4e26] underline decoration-2">Dashboard</Link>
            <Link href="/profile" className="text-black hover:text-[#ff4e26]">Profile</Link>
            <Link href="/dashboard/history" className="text-black hover:text-[#ff4e26]">History</Link>
            <form
              action={async () => {
                "use server"
                await signOut({ redirectTo: "/" })
              }}
            >
              <Button type="submit" variant="ghost" size="sm" className="font-bold border-transparent">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </nav>

      {/* Hero strip */}
      <div className="border-b-3 border-black bg-[#ff4e26]">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col md:flex-row items-start md:items-end justify-between gap-6">
          <div>
            <p className="text-white/80 font-bold uppercase text-xs tracking-widest mb-2">AI Resume Pipeline</p>
            <h1 className="text-4xl md:text-5xl font-extrabold uppercase tracking-tight text-white leading-none">
              Hey, {firstName}.
            </h1>
            <p className="text-white/90 font-semibold mt-3 max-w-md text-sm leading-relaxed">
              Your AI-powered resume tailoring studio. Paste a job post, pick a template, get an ATS-optimized PDF.
            </p>
          </div>
          <div className="flex gap-3 shrink-0">
            <div className="border-2 border-white/60 px-4 py-3 text-center">
              <p className="text-2xl font-extrabold text-white">AI</p>
              <p className="text-[10px] font-bold uppercase text-white/70">Powered</p>
            </div>
            <div className="border-2 border-white/60 px-4 py-3 text-center">
              <p className="text-2xl font-extrabold text-white">ATS</p>
              <p className="text-[10px] font-bold uppercase text-white/70">Optimized</p>
            </div>
            <div className="border-2 border-white/60 px-4 py-3 text-center">
              <p className="text-2xl font-extrabold text-white">PDF</p>
              <p className="text-[10px] font-bold uppercase text-white/70">Output</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-6xl mx-auto px-6 py-10 space-y-6">

        {/* Primary action — Generate (full width, featured) */}
        <div className="border-3 border-black bg-white shadow-[6px_6px_0px_#000000] overflow-hidden">
          {/* Orange accent bar */}
          <div className="h-2 bg-[#ff4e26]" />
          <div className="p-8 flex flex-col md:flex-row gap-8 items-start md:items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3">
                <span className="bg-[#ff4e26] text-white text-xs font-extrabold uppercase px-2 py-1 border-2 border-black shadow-[2px_2px_0px_#000000]">
                  Primary Action
                </span>
                <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Step 1 of 1</span>
              </div>
              <h2 className="text-2xl md:text-3xl font-extrabold uppercase tracking-tight mb-3">
                Generate Tailored Resume
              </h2>
              <p className="text-sm font-medium text-zinc-700 max-w-lg leading-relaxed mb-4">
                Paste a job description and let the multi-agent AI pipeline adapt your resume — extracting keywords, rewriting bullets, and rendering a pixel-perfect PDF.
              </p>
              {/* 5–10 min notice */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <div className="inline-flex items-center gap-2 bg-yellow-100 border-2 border-black px-4 py-2 shadow-[2px_2px_0px_#000000] text-sm font-bold">
                  <span className="w-2 h-2 rounded-full bg-yellow-500 shrink-0" />
                  This process may take 5–10 minutes to complete.
                </div>
                <span className="text-xs font-bold text-zinc-500">
                  Safe to close tab & return later — running on server.
                </span>
              </div>
            </div>
            <div className="shrink-0 w-full md:w-auto">
              <Link href="/dashboard/generate">
                <Button size="lg" className="w-full md:w-auto text-base px-10">
                  Tailor Resume &rarr;
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Secondary actions — Profile + History side by side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Profile */}
          <div className="border-3 border-black bg-white shadow-[4px_4px_0px_#000000] overflow-hidden group hover:-translate-y-1 hover:shadow-[6px_6px_0px_#000000] transition-all">
            <div className="h-2 bg-yellow-400" />
            <div className="p-6 flex flex-col h-full">
              <div className="mb-4">
                <div className="w-10 h-10 bg-yellow-400 border-2 border-black shadow-[2px_2px_0px_#000000] flex items-center justify-center mb-4">
                  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                  </svg>
                </div>
                <h2 className="text-xl font-extrabold uppercase tracking-tight mb-2">Build Your Profile</h2>
                <p className="text-sm font-medium text-zinc-700 leading-relaxed">
                  Add and manage your work experience, projects, education, and skills. The AI tailors from this data.
                </p>
              </div>
              <div className="mt-auto pt-4">
                <Link href="/profile">
                  <Button variant="outline" className="w-full bg-transparent text-black">
                    Edit Profile
                  </Button>
                </Link>
              </div>
            </div>
          </div>

          {/* History */}
          <div className="border-3 border-black bg-white shadow-[4px_4px_0px_#000000] overflow-hidden group hover:-translate-y-1 hover:shadow-[6px_6px_0px_#000000] transition-all">
            <div className="h-2 bg-black" />
            <div className="p-6 flex flex-col h-full">
              <div className="mb-4">
                <div className="w-10 h-10 bg-black border-2 border-black shadow-[2px_2px_0px_#000000] flex items-center justify-center mb-4">
                  <svg width="18" height="18" fill="none" stroke="white" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path d="M12 8v4l3 3" />
                    <circle cx="12" cy="12" r="9" />
                  </svg>
                </div>
                <h2 className="text-xl font-extrabold uppercase tracking-tight mb-2">View History</h2>
                <p className="text-sm font-medium text-zinc-700 leading-relaxed">
                  Access and download all previously generated and tailored resume versions from every run.
                </p>
              </div>
              <div className="mt-auto pt-4">
                <Link href="/dashboard/history">
                  <Button variant="outline" className="w-full bg-transparent text-black">
                    View History
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Info strip */}
        <div className="border-3 border-black bg-black text-white p-5 shadow-[4px_4px_0px_#ff4e26] flex flex-col md:flex-row items-start md:items-center gap-4 justify-between">
          <p className="text-xs font-bold uppercase tracking-widest text-white/60">How it works</p>
          <div className="flex flex-col md:flex-row gap-4 md:gap-10 text-sm font-bold">
            <span><span className="text-[#ff4e26] mr-2">01</span>Build your profile</span>
            <span className="text-white/30 hidden md:inline">/</span>
            <span><span className="text-[#ff4e26] mr-2">02</span>Paste job description</span>
            <span className="text-white/30 hidden md:inline">/</span>
            <span><span className="text-[#ff4e26] mr-2">03</span>Download ATS resume PDF</span>
          </div>
        </div>
      </div>
    </main>
  )
}
