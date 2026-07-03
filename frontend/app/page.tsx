import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LoginModal } from "@/components/LoginModal";
import { Footer } from "@/components/Footer";

const outcomes = ["Job", "Focus", "Resume", "PDF"];

const proof = [
  "job-focused",
  "quality",
  "on the fly",
  "free for now",
  "self-hostable",
  "5/day",
];

const steps = [
  { title: "Paste job", text: "Drop in role text." },
  { title: "Pick focus", text: "Project, balanced, experience." },
  { title: "Get PDF", text: "Tailored resume, saved." },
];

const signals = [
  "Role fit",
  "ATS shape",
  "Proof",
  "Page fit",
  "Keywords",
  "History",
];

const stackCards = [
  {
    number: "01",
    title: "Free",
    text: "Free for now because nobody is using it.",
  },
  {
    number: "02",
    title: "Private",
    text: "Do not trust hosted? Run your own.",
  },
  { number: "03", title: "Open", text: "Source lives on GitHub." },
];

export default async function Home() {
  const session = await auth();

  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#fbfbf3] text-zinc-950">
      <div className="landing-noise" aria-hidden="true" />
      <nav className="relative z-20 px-5 py-4 md:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between border-b border-zinc-950/15 pb-4">
          <span className="resumer-mark px-3 py-1.5 text-xl font-black md:text-2xl">
            Resumer
          </span>
          <div className="hidden items-center gap-6 text-xs font-black uppercase tracking-[0.22em] text-zinc-500 md:flex">
            <a href="#flow" className="transition hover:text-zinc-950">
              Generate
            </a>
            <a href="#trust" className="transition hover:text-zinc-950">
              Self-host
            </a>
            <a href="#launch" className="transition hover:text-zinc-950">
              Start
            </a>
          </div>
          <LoginModal />
        </div>
      </nav>

      <section className="relative mx-auto grid min-h-[calc(100dvh-88px)] max-w-7xl items-center gap-10 px-5 pb-20 pt-10 md:grid-cols-[0.95fr_1.05fr] md:px-8 md:pb-24 md:pt-8">
        <div
          className="landing-glow left-[-16rem] top-10 bg-[#ff4e26]/20"
          aria-hidden="true"
        />
        <div
          className="landing-glow right-[-10rem] top-52 bg-yellow-300/20"
          aria-hidden="true"
        />

        <div className="relative z-10 max-w-3xl landing-rise">
          <p className="mb-5 inline-flex border border-zinc-950 bg-white px-3 py-1 text-xs font-black uppercase tracking-[0.28em] shadow-[2px_2px_0_#18181b]">
            resumer.aryansingh.space
          </p>
          <h1 className="max-w-4xl text-4xl font-black uppercase  text-zinc-950 sm:text-5xl lg:text-7xl">
            Quality job-focused resumes on the fly.
          </h1>
          <div className="login-highlight mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
            <LoginModal />
            <span className="text-xs font-black uppercase tracking-[0.24em] text-zinc-500">
              5 generations per day.
            </span>
          </div>
        </div>

        <div className="relative min-h-[540px] landing-rise-delay md:min-h-[680px]">
          <div className="landing-orb landing-float absolute right-2 top-2 h-72 w-72 rounded-full md:right-10 md:h-[28rem] md:w-[28rem]" />
          <div className="landing-ui-card absolute left-0 top-10 w-[88%] max-w-[31rem] rotate-[-3deg] p-5 md:left-8 md:top-16">
            <div className="mb-8 flex items-center justify-between text-xs font-black uppercase tracking-[0.24em] text-zinc-400">
              <span>Job post</span>
              <span className="text-[#ff4e26]">Pasted</span>
            </div>
            <div className="grid gap-3">
              <div className="h-4 w-4/5 rounded-full bg-zinc-950" />
              <div className="h-4 w-2/3 rounded-full bg-zinc-200" />
              <div className="h-4 w-11/12 rounded-full bg-zinc-200" />
              <div className="mt-4 grid grid-cols-3 gap-2">
                {outcomes.map((item) => (
                  <span
                    key={item}
                    className="border border-zinc-950 bg-[#fbfbf3] px-2 py-3 text-center text-[10px] font-black uppercase tracking-[0.2em]"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="landing-ui-card absolute bottom-16 right-0 w-[88%] max-w-[34rem] rotate-[2deg] bg-zinc-950 p-5 text-white md:bottom-24">
            <div className="mb-5 flex items-center justify-between text-xs font-black uppercase tracking-[0.26em] text-[#ff4e26]">
              <span>Resume run</span>
              <span>Live</span>
            </div>
            <div className="space-y-3">
              {signals.slice(0, 4).map((signal, index) => (
                <div
                  key={signal}
                  className="grid grid-cols-[7rem_1fr] items-center gap-3 text-xs font-black uppercase tracking-[0.18em] text-zinc-300"
                >
                  <span>{signal}</span>
                  <span className="h-3 overflow-hidden rounded-full bg-white/15">
                    <span
                      className="landing-meter block h-full bg-[#ff4e26]"
                      style={{ width: `${92 - index * 13}%` }}
                    />
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-8 text-4xl font-black uppercase leading-[0.92] tracking-[-0.045em] md:text-6xl">
              Draft. Render. Download.
            </p>
          </div>
        </div>
      </section>

      <section
        className="border-y border-zinc-950 bg-zinc-950 py-5 text-[#fbfbf3]"
        aria-label="Product qualities"
      >
        <div className="landing-marquee flex gap-4 text-2xl font-black uppercase tracking-[-0.025em] md:text-5xl">
          {[...proof, ...proof].map((item, index) => (
            <span key={`${item}-${index}`} className="shrink-0 px-3">
              {item}
              <span className="ml-6 text-[#ff4e26]">/</span>
            </span>
          ))}
        </div>
      </section>

      <section
        id="flow"
        className="mx-auto max-w-7xl px-5 py-24 md:px-8 md:py-32"
      >
        <div className="grid gap-8 md:grid-cols-[0.85fr_1.15fr] md:items-start">
          <h2 className="max-w-2xl text-5xl font-black uppercase leading-[0.94] tracking-[-0.045em] md:text-7xl">
            Generate quality without résumé theater.
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {steps.map((step, index) => (
              <article
                key={step.title}
                className="landing-reveal landing-ui-card min-h-64 p-5"
                style={{ animationDelay: `${index * 120}ms` }}
              >
                <span className="text-6xl font-black tracking-[-0.08em] text-[#ff4e26]">
                  0{index + 1}
                </span>
                <h3 className="mt-10 text-2xl font-black uppercase tracking-[-0.025em]">
                  {step.title}
                </h3>
                <p className="mt-3 text-sm font-bold leading-7 tracking-[-0.005em] text-zinc-600">
                  {step.text}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="signal"
        className="mx-auto max-w-7xl px-5 pb-24 md:px-8 md:pb-32"
      >
        <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="landing-ui-card overflow-hidden bg-zinc-950 text-white">
            <div className="grid min-h-[34rem] content-between p-6 md:p-10">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {signals.map((signal, index) => (
                  <div
                    key={signal}
                    className="landing-signal-tile border border-white/15 bg-white/[0.06] p-4"
                    style={{ animationDelay: `${index * 90}ms` }}
                  >
                    <span className="text-xs font-black uppercase tracking-[0.24em] text-[#ff4e26]">
                      Signal
                    </span>
                    <p className="mt-8 text-2xl font-black uppercase leading-[0.95] tracking-[-0.025em]">
                      {signal}
                    </p>
                  </div>
                ))}
              </div>
              <h2 className="mt-16 max-w-3xl text-5xl font-black uppercase leading-[0.92] tracking-[-0.045em] md:text-8xl">
                Focused for each job.
              </h2>
            </div>
          </div>
          <div className="grid gap-5">
            <div className="landing-ui-card bg-[#ff4e26] p-6 text-white">
              <p className="text-6xl font-black uppercase leading-[0.92] tracking-[-0.045em] md:text-8xl">
                5/day
              </p>
              <p className="mt-4 max-w-xs text-sm font-black uppercase leading-6 tracking-[0.14em] text-white/80">
                Limit per person while it is free.
              </p>
            </div>
            <div className="landing-ui-card p-6">
              <div className="flex items-center justify-between border-b border-zinc-200 pb-4 text-xs font-black uppercase tracking-[0.24em] text-zinc-400">
                <span>Runs</span>
                <span>Saved</span>
              </div>
              <div className="mt-6 space-y-3">
                {["Frontend role", "AI role", "Internship"].map((role) => (
                  <div
                    key={role}
                    className="flex items-center justify-between border border-zinc-200 bg-zinc-50 p-3 text-sm font-black"
                  >
                    <span>{role}</span>
                    <span className="h-3 w-3 bg-[#ff4e26]" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="trust"
        className="bg-zinc-950 px-5 py-24 text-white md:px-8 md:py-32"
      >
        <div className="mx-auto grid max-w-7xl gap-5 md:grid-cols-3">
          {stackCards.map((card, index) => (
            <article
              key={card.title}
              className="landing-stack-card min-h-[24rem] border border-white/15 bg-white/[0.04] p-6"
              style={{ top: `${96 + index * 18}px` }}
            >
              <span className="text-sm font-black uppercase tracking-[0.24em] text-[#ff4e26]">
                {card.number}
              </span>
              <h2 className="mt-20 text-5xl font-black uppercase leading-[0.94] tracking-[-0.045em] md:text-7xl">
                {card.title}
              </h2>
              <p className="mt-5 max-w-xs text-base font-bold leading-8 tracking-[-0.005em] text-zinc-400">
                {card.text}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section
        id="launch"
        className="relative mx-auto max-w-7xl px-5 py-24 md:px-8 md:py-32"
      >
        <div
          className="landing-glow left-1/2 top-20 -translate-x-1/2 bg-[#ff4e26]/20"
          aria-hidden="true"
        />
        <div className="landing-ui-card relative overflow-hidden bg-white p-8 md:p-12">
          <div
            className="absolute right-0 top-0 h-40 w-40 bg-[#ff4e26]"
            aria-hidden="true"
          />
          <div className="relative max-w-4xl">
            <h2 className="text-6xl font-black uppercase leading-[0.9] tracking-[-0.055em] md:text-9xl">
              Do not trust me with your data?
            </h2>
            <p className="mt-7 max-w-lg text-lg font-bold leading-relaxed tracking-[-0.01em] text-zinc-600">
              Host it yourself. Code is public.
            </p>
            <div className="login-highlight mt-9 flex flex-col gap-4 sm:flex-row sm:items-center">
              <LoginModal />
              <a
                href="https://github.com/Wizhill05/resumer-v2"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-12 items-center justify-center border-2 border-zinc-950 bg-white px-5 text-sm font-black uppercase tracking-wide text-zinc-950 shadow-[3px_3px_0_#18181b] transition hover:-translate-y-0.5 hover:shadow-[5px_5px_0_#18181b] active:translate-y-0"
              >
                GitHub
              </a>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
