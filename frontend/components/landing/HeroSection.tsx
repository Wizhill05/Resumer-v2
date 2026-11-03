import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { FluidField } from "@/components/landing/FluidField"
import { LoginModal } from "@/components/LoginModal"
import { CalligraphyTitle } from "@/components/landing/CalligraphyTitle"
import { HeroThemeToggle } from "@/components/landing/HeroThemeToggle"
import { CopyAgentPrompt } from "@/components/landing/CopyAgentPrompt"
import { agentPrompt } from "@/lib/agent-prompt"

function ChatGPTMark({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.48 4.48 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-3.494 4.494M3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646M2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.677l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zM8.309 12.863l-2.02-1.159a.08.08 0 0 1-.038-.057V6.074a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.459a.795.795 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  )
}

function AgentMark({ agent }: { agent: "opencode" | "claude" | "pi" }) {
  if (agent === "pi") {
    return (
      <svg width="14" height="14" viewBox="0 0 800 800" fill="currentColor" aria-hidden="true" className="shrink-0">
        <path d="M165.29 165.29H517.36V400H400V282.65H165.29Z M165.29 282.65H282.65V400H400V517.36H282.65V634.72H165.29Z M517.36 400H634.72V634.72H517.36Z" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="shrink-0">
      <path d={agent === "opencode" ? "M22 24H2V0h20zM17 4.8H7v14.4h10z" : "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"} />
    </svg>
  )
}

const subtleButton =
  "group inline-flex items-center justify-center gap-1.5 sm:gap-2 border border-[var(--fluid-ink)]/25 bg-white/40 px-2.5 py-1.5 text-xs font-semibold sm:px-4 sm:py-2 sm:text-sm text-[var(--fluid-ink)] backdrop-blur-sm transition-colors hover:border-[var(--fluid-ink)]/50 hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fluid-ink)] dark:border-white/25 dark:bg-white/5 dark:text-[var(--fluid-ink)] dark:hover:border-white/50 dark:hover:bg-white/10 dark:focus-visible:outline-white"

export function HeroSection() {
  const mcpUrl = process.env.NEXT_PUBLIC_MCP_URL || "https://resumer-backend.aryansingh.space/mcp"

  return (
    <section className="relative flex h-[50dvh] min-h-[300px] flex-col overflow-hidden border-b border-black/10 bg-[var(--fluid-canvas)] md:h-auto md:min-h-[100dvh] dark:border-white/10">
      <FluidField />

      {/* Glass nav — fixed to the top always even when scrolling */}
      <header className="fixed top-0 inset-x-0 z-50 px-0 md:top-4 md:px-5 pointer-events-none">
        <div className="pointer-events-auto mx-auto flex h-11 w-full max-w-5xl items-center justify-between border-b border-black/10 bg-white/70 px-4 backdrop-blur-xl md:border md:border-black/10 md:shadow-[0_18px_50px_-24px_rgba(74,32,4,0.55)] dark:border-white/10 dark:bg-black/60 md:dark:bg-black/60">
          <Link
            href="/"
            className="text-base font-black tracking-tight text-[var(--fluid-ink)]"
          >
            R<span className="normal-case">é</span>SUMER
          </Link>
          <div className="flex items-center gap-3 text-xs font-semibold sm:gap-4">
            <LoginModal
              triggerClassName="rounded-none text-[var(--fluid-ink)]/80 transition-colors hover:text-[var(--fluid-ink)]"
            >
              Sign in
            </LoginModal>
            <Link
              href="/try"
              className="inline-flex items-center gap-1 text-[var(--fluid-ink)]/80 transition-colors hover:text-[var(--fluid-ink)]"
            >
              Guest Mode
              <ArrowUpRight size={13} />
            </Link>
            <div className="h-3.5 w-px bg-[var(--fluid-ink)]/20" aria-hidden="true" />
            <HeroThemeToggle />
          </div>
        </div>
      </header>

      {/* Pure Center: Hero Calligraphy Title centered in the screen */}
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4 pt-8 sm:px-5 sm:pt-0">
        <div className="pointer-events-auto flex w-full max-w-5xl justify-center">
          <CalligraphyTitle className="hero-calligraphy w-full max-w-[18rem] xs:max-w-[22rem] sm:max-w-[34rem] md:max-w-[46rem] lg:max-w-[54rem] xl:max-w-[60rem] 2xl:max-w-[64rem]" />
        </div>
      </div>

      {/* Login and guest actions with agent compatibility link */}
      <div className="relative z-20 mt-auto flex flex-col items-center justify-end px-4 pb-6 sm:px-5 sm:pb-10 md:pb-14">
        <div className="hero-sub-elements flex flex-col items-center gap-2 sm:gap-4">
          <div className="flex flex-row flex-wrap items-center justify-center gap-2 sm:gap-4">
            <LoginModal
              triggerClassName={subtleButton}
              callbackUrl="/dashboard"
            >
              Login via Google / GitHub
            </LoginModal>
            <Link
              href="/try"
              className={subtleButton}
            >
              <span>Continue as Guest!</span>
              <ArrowUpRight
                size={14}
                className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </Link>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <Link
              href="/agent"
              className="inline-flex items-center gap-2 text-[11px] font-medium text-[var(--fluid-ink-soft)] transition-colors hover:text-[var(--fluid-ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--fluid-ink)] sm:text-sm"
            >
              <span>Connect your agent</span>
              <span className="inline-flex items-center gap-1.5" aria-hidden="true">
                <AgentMark agent="opencode" />
                <AgentMark agent="claude" />
                <AgentMark agent="pi" />
                <ChatGPTMark />
              </span>
            </Link>
            <CopyAgentPrompt prompt={agentPrompt(mcpUrl)} />
          </div>
        </div>
      </div>
    </section>
  )
}
