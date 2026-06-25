import { auth, signIn } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { redirect } from "next/navigation"
import { Header } from "@/components/Header"

export default async function Home() {
  const session = await auth()

  if (session) {
    redirect("/dashboard")
  }

  return (
    <main className="min-h-screen bg-[#fdfbf7] text-[#121212] pt-24 pb-16 flex flex-col justify-between">
      <Header isLoggedIn={false} />

      {/* Hero Section */}
      <section className="max-w-4xl mx-auto px-6 py-12 md:py-20 flex-grow flex flex-col justify-center space-y-8">
        <div className="space-y-4">
          <span className="text-xs font-bold uppercase tracking-widest text-[#ff4e26] bg-orange-50 border border-orange-100 rounded-full px-4 py-1.5 w-fit">
            Next-Gen Resume Tailoring
          </span>
          
          <h1 className="font-heading text-5xl sm:text-7xl md:text-8xl font-extrabold tracking-tighter leading-none text-left select-none uppercase">
            your resume,
            <br />
            <span className="text-[#ff4e26]">tailored in seconds.</span>
          </h1>
        </div>

        <p className="text-lg md:text-xl text-zinc-600 font-medium leading-relaxed max-w-2xl text-left">
          Paste a job description. Let our multi-agent pipeline analyze requirements, highlight accomplishments, and format an ATS-optimized layout instantly.
        </p>

        {/* Side-by-Side CTAs */}
        <div className="flex flex-col sm:flex-row gap-4 w-full justify-start pt-4">
          <form
            action={async () => {
              "use server"
              await signIn("github")
            }}
            className="w-full sm:w-auto"
          >
            <Button type="submit" size="lg" className="w-full">
              Get started with GitHub
            </Button>
          </form>
          <form
            action={async () => {
              "use server"
              await signIn("google")
            }}
            className="w-full sm:w-auto"
          >
            <Button type="submit" size="lg" variant="outline" className="w-full">
              Continue with Google
            </Button>
          </form>
        </div>
      </section>

      {/* Decorative / Section anchors behind hamburger menu options */}
      <div className="max-w-4xl mx-auto w-full px-6 space-y-12 mt-12 opacity-80">
        <div id="how-it-works" className="pt-12 border-t border-zinc-100">
          <h2 className="font-heading text-xl font-bold uppercase tracking-wide text-[#ff4e26] mb-3">How it Works</h2>
          <p className="text-sm font-medium text-zinc-500 leading-relaxed">
            Our multi-agent pipeline orchestrates specific AI agents (job analyzer, profile selector, bullet re-writer) in a LangGraph structure. It retrieves your profile data, picks the best projects/experience, re-writes the bullets for semantic fit, and renders a single-page PDF with WeasyPrint.
          </p>
        </div>

        <div id="templates" className="pt-8 border-t border-zinc-100">
          <h2 className="font-heading text-xl font-bold uppercase tracking-wide text-[#ff4e26] mb-3">Templates</h2>
          <p className="text-sm font-medium text-zinc-500 leading-relaxed">
            Beautiful layouts configured with strict constraints. Tested to compile successfully on WeasyPrint. Options include Compact, Modern Classic, and high-impact single column formats.
          </p>
        </div>

        <div id="pricing" className="pt-8 border-t border-zinc-100">
          <h2 className="font-heading text-xl font-bold uppercase tracking-wide text-[#ff4e26] mb-3">Pricing</h2>
          <p className="text-sm font-medium text-zinc-500 leading-relaxed font-bold">
            Resumer is free forever. No payment required.
          </p>
        </div>
      </div>

      {/* Simple Footer */}
      <footer className="max-w-4xl mx-auto w-full px-6 text-center text-xs font-bold text-zinc-400 mt-20 tracking-wider uppercase">
        © resumer. open source.
      </footer>
    </main>
  )
}
