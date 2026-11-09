"use client"

import localFont from "next/font/local"
import { PERSON, PROJECT_POOL, type ResumeVariant } from "./demo-data"
import { Typed } from "./Typed"
import styles from "./Landing.module.css"

/** Computer Modern, the face the real PDF templates render in. */
export const resumeSerif = localFont({
  src: [
    { path: "./fonts/cmunrm.woff2", weight: "400", style: "normal" },
    { path: "./fonts/cmunti.woff2", weight: "400", style: "italic" },
    { path: "./fonts/cmunbx.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
})

export type ProjectMode = "pool" | "selecting" | "picked"

interface ResumeSheetProps {
  content: ResumeVariant
  /** Projects the current job selects, as PROJECT_POOL indexes. */
  picked: number[]
  projectMode: ProjectMode
  /** Content currently spills past one page. */
  over: boolean
  /** Show the page-count badge. */
  showFit: boolean
  /** True once mounted: rows that appear later type themselves in. */
  live: boolean
}

export function ResumeSheet({ content, picked, projectMode, over, showFit, live }: ResumeSheetProps) {
  return (
    <div
      className={`${styles.sheet} ${resumeSerif.className} ${over ? styles.over : ""}`}
      role="img"
      aria-label={`Sample one-page résumé for ${PERSON.name}, tailored as ${content.role}`}
    >
      <div className={styles.page} aria-hidden="true">
        <div className={styles.head}>
          <div>
            <div className={styles.name}>{PERSON.name}</div>
            <div className={styles.role}>
              <Typed text={content.role} />
            </div>
          </div>
          <div className={styles.contact}>
            {PERSON.email}
            <br />
            {PERSON.site}
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Education</div>
          <div className={styles.row}>
            <span>
              <b>{PERSON.degree}</b> | {PERSON.school}
            </span>
            <span className={styles.muted}>{PERSON.years}</span>
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Skills</div>
          <dl className={styles.skills}>
            {content.skills.map((row, i) => (
              <div key={i} className="contents">
                <dt>
                  <Typed text={row.label} delay={i * 70} />
                </dt>
                <dd>
                  <Typed text={row.items} delay={i * 70} />
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Experience</div>
          <div className={styles.row}>
            <span>
              <b>{PERSON.title}</b> | {PERSON.company}
            </span>
            <span className={styles.muted}>{PERSON.dates}</span>
          </div>
          <ul className={styles.bullets}>
            {content.experience.map((bullet, i) => (
              <li key={i}>
                <Typed text={bullet} delay={160 + i * 110} />
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Projects</div>
          {PROJECT_POOL.map((project, i) => {
            const isPicked = picked.includes(i)
            const bullets = content.projects[i]
            const state =
              isPicked || projectMode === "pool"
                ? projectMode === "selecting"
                  ? styles.keeping
                  : ""
                : projectMode === "selecting"
                  ? styles.dropping
                  : styles.foldClosed
            return (
              <div key={project.name} className={`${styles.fold} ${state}`}>
                <div>
                  <div className={styles.row}>
                    <span className={styles.projectTitle}>
                      <b>{project.name}</b> | {project.tag}
                    </span>
                  </div>
                  <div className={`${styles.fold} ${bullets ? "" : styles.foldClosed}`}>
                    <div>
                      {bullets && (
                        <ul className={styles.bullets}>
                          {bullets.map((bullet, j) => (
                            <li key={j}>
                              <Typed text={bullet} delay={380 + j * 110} typeOnMount={live} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className={`${styles.fitLine} ${showFit ? styles.fitShown : ""}`} aria-hidden="true">
        <span className={styles.fitBadge}>{over ? "1.1 pages" : "1 page"}</span>
      </div>
      <span className={styles.sheen} aria-hidden="true" />
    </div>
  )
}
