import { Nav } from "@/components/Nav"
import { Footer } from "@/components/Footer"
import { PageHero } from "@/components/PageHero"

export default function PrivacyPage() {
  return (
    <main className="app-surface flex min-h-screen flex-col">
      <Nav />
      <PageHero
        narrow
        title="Privacy"
        subtitle="What Résumer stores, why, and what it never does with your data."
      />
      <div className="page-wrap max-w-4xl flex-1">
        <section className="soft-card p-6 md:p-10">
          <div className="space-y-5 text-[0.95rem] leading-relaxed text-ink-muted">
            <p>Résumer stores account, profile, job description, generation history, and résumé output data needed to provide résumé generation features.</p>
            <p>We use this data to authenticate you, build résumés, show past generations, and improve reliability. We do not sell personal data.</p>
            <p>We use PostHog to understand visits, page navigation, résumé generation results, and PDF download clicks. Analytics can link signed-in activity using your account email. We do not intentionally send résumé contents, job descriptions, or custom instructions as analytics event properties.</p>
            <p>Session replay is disabled on the trial, dashboard, profile, onboarding, account, authorization, and support pages. On public pages, replay masks text, inputs, and element attributes. Private support pages are excluded from analytics events.</p>
            <p>No-login trial uses essential cookies to keep an anonymous guest session, enforce the 5-résumé daily limit, and protect access to guest downloads. These cookies do not store your full résumé content.</p>
            <p>Guest draft details imported or typed in the trial are stored in your browser device storage. They are sent to the server only when you import résumés for parsing or generate a résumé.</p>
            <p>Guest generation inputs and artifacts may be stored temporarily so the pipeline can finish and you can download the PDF. Guest artifacts are intended to expire and are not account history.</p>
            <p>OAuth providers may share basic account details such as name, email, and avatar depending on provider settings.</p>
            <p>Connecting GitHub stores an encrypted access token that is used only to read your repositories. If you opt in to private repos, GitHub grants full repo access, but Résumer only reads repository details and never writes. README and manifest text from imported repos, including private ones you choose to import, is sent to our AI provider to draft the project. You can disconnect GitHub or remove private repo access at any time from the Account page.</p>
            <p>You can delete generated history inside app where supported. For account or data removal requests, contact project owner/admin.</p>
            <p>This policy may change as product changes. Continued use means updated policy applies.</p>
          </div>
        </section>
      </div>
      <Footer />
    </main>
  )
}
