import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { FluidField } from "@/components/landing/FluidField"
import { LoginModal } from "@/components/LoginModal"
import styles from "./Landing.module.css"

export function Closing() {
  return (
    <section className="relative overflow-hidden bg-[var(--fluid-canvas)] px-5 py-32 sm:py-44">
      <FluidField variant="banner" />
      <div className="landing-reveal relative z-10 mx-auto flex max-w-xl flex-col items-center text-center">
        <h2 className="text-6xl font-light tracking-[-0.05em] text-[var(--fluid-ink)] sm:text-7xl lg:text-8xl">
          Your turn.
        </h2>
        <div className="mt-10 flex items-center gap-2.5">
          <LoginModal triggerClassName={styles.primary} callbackUrl="/dashboard">
            Get started
          </LoginModal>
          <Link href="/try" className={`${styles.ghost} group`}>
            <span>Try as guest</span>
            <ArrowUpRight
              size={14}
              className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              aria-hidden="true"
            />
          </Link>
        </div>
      </div>
    </section>
  )
}
