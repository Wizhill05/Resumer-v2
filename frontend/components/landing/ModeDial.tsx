"use client"

import { useState } from "react"
import { INVENTED_PROJECT, LARP_MODES } from "./demo-data"
import { resumeSerif } from "./ResumeSheet"
import { Typed } from "./Typed"
import styles from "./Landing.module.css"

/**
 * The generation-mode dial: one résumé line, three levels of creative licence.
 * Mirrors the Proper / LARP / Super LARP selector in the real generator.
 */
export function ModeDial() {
  const [level, setLevel] = useState(0)
  const mode = LARP_MODES[level]
  const heat = level / (LARP_MODES.length - 1)

  return (
    <section
      aria-labelledby="mode-dial-heading"
      className="relative overflow-hidden px-5 py-24 sm:py-32 lg:py-40"
      style={{ "--heat": heat } as React.CSSProperties}
    >
      <div className="landing-reveal mx-auto max-w-2xl text-center">
        <p className={styles.eyebrow}>Generation mode</p>
        <h2
          id="mode-dial-heading"
          className="mt-4 text-5xl font-light tracking-[-0.045em] text-[var(--fluid-ink)] sm:text-6xl lg:text-7xl"
        >
          How bold?
        </h2>

        <div className="relative mt-12 sm:mt-16">
          <span className={styles.heat} aria-hidden="true" />
          <div className={`${styles.strip} ${resumeSerif.className}`} aria-live="polite">
            <div className={`${styles.fold} ${mode.invented ? "" : styles.foldClosed}`}>
              <div>
                <div>
                  <b>{INVENTED_PROJECT.name}</b> | {INVENTED_PROJECT.tag}
                  <span className={styles.invented}>invented</span>
                </div>
                <ul className={styles.bullets} style={{ marginBottom: "0.7em" }}>
                  <li>
                    <Typed key={String(mode.invented)} text={INVENTED_PROJECT.bullet} typeOnMount={mode.invented} />
                  </li>
                </ul>
              </div>
            </div>
            <div>
              <b>PaperTrail</b> | RAG search over course notes
            </div>
            <ul className={styles.bullets}>
              <li>
                <Typed text={mode.bullet} />
              </li>
            </ul>
          </div>
        </div>

        <div className={`${styles.dial} mt-12 sm:mt-14`}>
          <div className={styles.dialTrack} aria-hidden="true">
            <span className={styles.dialFill} />
            {LARP_MODES.map((item, i) => (
              <span
                key={item.id}
                className={styles.dialTick}
                style={{ left: `${(i / (LARP_MODES.length - 1)) * 100}%` }}
              />
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={LARP_MODES.length - 1}
            step={1}
            value={level}
            onChange={(event) => setLevel(Number(event.target.value))}
            aria-label="Generation mode"
            aria-valuetext={`${mode.label}: ${mode.hint}`}
            className={styles.range}
          />
          <div className={styles.dialLabels}>
            {LARP_MODES.map((item, i) => (
              <button
                key={item.id}
                type="button"
                tabIndex={-1}
                onClick={() => setLevel(i)}
                className={`${styles.dialLabel} ${i === level ? styles.dialLabelActive : ""}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-5 text-sm text-[var(--fluid-ink-soft)]">{mode.hint}</p>
      </div>
    </section>
  )
}
