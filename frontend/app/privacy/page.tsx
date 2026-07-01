import Link from "next/link"

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#fbfbf3] px-5 py-8 text-black md:px-8">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="resumer-mark px-3 py-1 text-xl font-black">
          Resumer
        </Link>
        <section className="mt-10 border border-zinc-900 bg-white p-6 shadow-[4px_4px_0_#18181b] md:p-10">
          <p className="text-xs font-extrabold uppercase tracking-[0.28em] text-[#ff4e26]">Privacy Policy</p>
          <h1 className="mt-4 text-4xl font-black uppercase leading-none tracking-[-0.07em] md:text-6xl">Your resume data stays purposeful.</h1>
          <div className="mt-8 space-y-5 text-sm font-semibold leading-relaxed text-zinc-600">
            <p>Resumer stores account, profile, job description, generation history, and resume output data needed to provide resume generation features.</p>
            <p>We use this data to authenticate you, build resumes, show past generations, and improve reliability. We do not sell personal data.</p>
            <p>OAuth providers may share basic account details such as name, email, and avatar depending on provider settings.</p>
            <p>You can delete generated history inside app where supported. For account or data removal requests, contact project owner/admin.</p>
            <p>This policy may change as product changes. Continued use means updated policy applies.</p>
          </div>
        </section>
      </div>
    </main>
  )
}
