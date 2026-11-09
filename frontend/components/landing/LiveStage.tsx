"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { ArrowDown, ArrowUpRight, FileCheck2 } from "lucide-react"
import { FluidField } from "@/components/landing/FluidField"
import { LoginModal } from "@/components/LoginModal"
import { JOBS, RAW, STAGES } from "./demo-data"
import { ResumeSheet, type ProjectMode } from "./ResumeSheet"
import styles from "./Landing.module.css"

/** Share of the pinned scroll spent on the hero before the pipeline starts. */
const HERO_SHARE = 0.08
const AUTO_CYCLE_MS = 4600
const FIT_SETTLE_MS = 1300
const MAX_TILT = 5

function Posting({ text, lit }: { text: string; lit: boolean }) {
  let keyword = 0
  return (
    <>
      {text.split(/(\[\[.+?\]\])/g).map((part, i) => {
        if (!part.startsWith("[[")) return part
        const delay = 250 + keyword++ * 220
        return (
          <span
            key={i}
            className={styles.postingKw}
            style={{ transitionDelay: lit ? `${delay}ms` : "0ms" }}
          >
            {part.slice(2, -2)}
          </span>
        )
      })}
    </>
  )
}

/**
 * The pinned opening of the landing page. Stage 0 is the hero: pick a job and
 * the résumé rewrites itself. Scrolling then replays one pipeline run on the
 * same sheet, stage by stage.
 */
export function LiveStage() {
  const sectionRef = useRef<HTMLElement>(null)
  const tiltRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState(0)
  const [jobIndex, setJobIndex] = useState(0)
  const [touched, setTouched] = useState(false)
  const [fitted, setFitted] = useState(false)
  const [live, setLive] = useState(false)

  // Scroll position -> pipeline stage.
  useEffect(() => {
    let raf = 0
    const update = () => {
      raf = 0
      setLive(true)
      const el = sectionRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const range = rect.height - window.innerHeight
      const progress = range > 0 ? Math.min(1, Math.max(0, -rect.top / range)) : 0
      const next =
        progress < HERO_SHARE
          ? 0
          : Math.min(
              STAGES.length,
              1 + Math.floor(((progress - HERO_SHARE) / (1 - HERO_SHARE)) * STAGES.length),
            )
      setStage((current) => (current === next ? current : next))
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
    }
  }, [])

  // Until someone picks a job, cycle through them so the page shows what it does.
  useEffect(() => {
    if (touched || stage !== 0) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const id = window.setInterval(() => {
      if (!document.hidden) setJobIndex((i) => (i + 1) % JOBS.length)
    }, AUTO_CYCLE_MS)
    return () => window.clearInterval(id)
  }, [touched, stage])

  // The fit stage first overflows the page, then settles onto one.
  useEffect(() => {
    if (stage !== 4) return
    const id = window.setTimeout(() => setFitted(true), FIT_SETTLE_MS)
    return () => {
      window.clearTimeout(id)
      setFitted(false)
    }
  }, [stage])

  // Tilt: cursor on desktop, device orientation on phones that allow it unprompted.
  useEffect(() => {
    const el = tiltRef.current
    if (!el) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    const apply = (x: number, y: number) => {
      el.style.setProperty("--ry", `${(x * MAX_TILT).toFixed(2)}deg`)
      el.style.setProperty("--rx", `${(-y * MAX_TILT).toFixed(2)}deg`)
      el.style.setProperty("--gx", `${(50 + x * 45).toFixed(1)}%`)
      el.style.setProperty("--gy", `${(40 + y * 45).toFixed(1)}%`)
    }
    const clamp = (v: number) => Math.min(1, Math.max(-1, v))

    const onPointer = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return
      apply(
        clamp((event.clientX / window.innerWidth) * 2 - 1),
        clamp((event.clientY / window.innerHeight) * 2 - 1),
      )
    }
    const onOrientation = (event: DeviceOrientationEvent) => {
      if (event.gamma == null || event.beta == null) return
      apply(clamp(event.gamma / 28), clamp((event.beta - 45) / 32))
    }

    window.addEventListener("pointermove", onPointer, { passive: true })
    const orientation = window.DeviceOrientationEvent as
      | (typeof DeviceOrientationEvent & { requestPermission?: unknown })
      | undefined
    const canOrient = Boolean(orientation) && typeof orientation?.requestPermission !== "function"
    if (canOrient) window.addEventListener("deviceorientation", onOrientation)
    return () => {
      window.removeEventListener("pointermove", onPointer)
      if (canOrient) window.removeEventListener("deviceorientation", onOrientation)
    }
  }, [])

  const job = JOBS[jobIndex]
  const picked = Object.keys(job.projects).map(Number)
  const analysing = stage === 1 || stage === 2
  const projectMode: ProjectMode = stage === 1 ? "pool" : stage === 2 ? "selecting" : "picked"
  const over = stage === 4 && !fitted
  const rendered = stage === 5
  const inHero = stage === 0
  const traceIndex = Math.max(1, stage) - 1
  const trace = STAGES[traceIndex]

  const pick = (index: number) => {
    setTouched(true)
    setJobIndex(index)
  }

  return (
    <section ref={sectionRef} className={styles.experience} aria-label="How Résumer works">
      <div className={styles.pin}>
        <FluidField />

        <div className={styles.grid}>
          <div className={`${styles.slot} ${styles.top}`}>
            <div className={`${styles.layer} ${inHero ? "" : styles.layerHidden}`}>
              <h1 className={styles.headline}>
                One profile.
                <br />
                <em>Every job.</em>
              </h1>
            </div>
            <div
              className={`${styles.layer} ${inHero ? styles.layerHidden : ""} flex flex-col items-center justify-end gap-2 lg:items-start lg:gap-4`}
              aria-live="polite"
            >
              <p className={styles.eyebrow}>
                0{traceIndex + 1} / {trace.node}
              </p>
              <p className={styles.caption}>{trace.caption}</p>
            </div>
          </div>

          <div className={styles.sheetArea}>
            <div className={styles.float}>
              <div ref={tiltRef} className={`${styles.tilt} ${rendered ? styles.rendered : ""}`}>
                <ResumeSheet
                  content={analysing ? RAW : job}
                  picked={picked}
                  projectMode={projectMode}
                  over={over}
                  showFit={stage === 4}
                  live={live}
                />

                <div
                  className={`${styles.posting} ${analysing ? styles.postingLit : styles.postingHidden}`}
                  aria-hidden={!analysing}
                >
                  <span className={styles.postingLabel}>job description</span>
                  <Posting text={job.posting} lit={analysing} />
                </div>

                <div
                  className={`${styles.file} ${rendered ? "" : styles.fileHidden}`}
                  aria-hidden={!rendered}
                >
                  <FileCheck2 size={15} aria-hidden="true" />
                  <span>{job.file}</span>
                </div>
              </div>
            </div>
          </div>

          <div className={`${styles.slot} ${styles.bottom}`}>
            <div
              className={`${styles.layer} ${inHero ? "" : styles.layerHidden} flex w-full flex-col items-center gap-4 lg:items-start lg:gap-7`}
              inert={!inHero}
            >
              <div className="flex max-w-full flex-col items-center gap-2 lg:items-start lg:gap-3">
                <p className={`${styles.eyebrow} hidden lg:block`}>Tailor it for</p>
                <div className={styles.chips} role="group" aria-label="Tailor the résumé for a job">
                  {JOBS.map((item, i) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={i === jobIndex}
                      onClick={() => pick(i)}
                      className={`${styles.chip} ${i === jobIndex ? styles.chipActive : ""}`}
                    >
                      {item.chip}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2.5">
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

            <div className={`${styles.layer} ${inHero ? styles.layerHidden : ""} flex w-full justify-center lg:justify-start`}>
              <ol className={styles.trace} aria-label="Pipeline stages">
                {STAGES.map((item, i) => (
                  <li
                    key={item.node}
                    aria-current={i === traceIndex ? "step" : undefined}
                    className={`${styles.traceItem} ${
                      i === traceIndex ? styles.traceActive : i < traceIndex ? styles.traceDone : ""
                    }`}
                  >
                    <span>{item.node}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>

        <p
          className={`${styles.scrollHint} ${styles.eyebrow}`}
          style={{ opacity: inHero ? 0.75 : 0 }}
          aria-hidden="true"
        >
          <ArrowDown size={12} />
          Scroll to watch a run
        </p>
      </div>
    </section>
  )
}
