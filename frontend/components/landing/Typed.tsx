"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import styles from "./Landing.module.css"

interface Segment {
  text: string
  keyword: boolean
}

function parse(source: string): Segment[] {
  return source
    .split(/(\[\[.+?\]\])/g)
    .filter(Boolean)
    .map((part) =>
      part.startsWith("[[")
        ? { text: part.slice(2, -2), keyword: true }
        : { text: part, keyword: false },
    )
}

const DONE = Number.MAX_SAFE_INTEGER

/**
 * Text that retypes itself whenever `text` changes. The untyped remainder is
 * rendered invisibly so the line never reflows mid-animation. The first render
 * shows the full text (no animation on load, and it is present for crawlers).
 */
export function Typed({
  text,
  delay = 0,
  typeOnMount = false,
}: {
  text: string
  delay?: number
  /** Type the text in when the node first appears (for rows added after load). */
  typeOnMount?: boolean
}) {
  const segments = useMemo(() => parse(text), [text])
  const total = useMemo(
    () => segments.reduce((sum, s) => sum + s.text.length, 0),
    [segments],
  )

  const [shown, setShown] = useState(typeOnMount ? 0 : DONE)
  const [previous, setPrevious] = useState(text)
  if (previous !== text) {
    setPrevious(text)
    setShown(0)
  }

  const animated = useRef<string | null>(typeOnMount ? null : text)
  useEffect(() => {
    if (animated.current === text) return
    animated.current = text

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = requestAnimationFrame(() => setShown(DONE))
      return () => {
        cancelAnimationFrame(id)
        animated.current = null
      }
    }

    const duration = Math.min(850, 260 + total * 5)
    const start = performance.now() + delay
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration))
      if (t >= 1) {
        setShown(DONE)
        return
      }
      setShown(Math.floor(t * total))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      animated.current = null
    }
  }, [text, total, delay])

  const typing = shown > 0 && shown < total
  const nodes: React.ReactNode[] = []
  let offset = 0
  segments.forEach((segment, i) => {
    const visibleCount = Math.max(0, Math.min(segment.text.length, shown - offset))
    const visible = segment.text.slice(0, visibleCount)
    const hidden = segment.text.slice(visibleCount)
    if (visible) {
      nodes.push(
        <span key={`v${i}`} className={segment.keyword ? styles.kw : undefined}>
          {visible}
        </span>,
      )
    }
    if (typing && shown >= offset && shown < offset + segment.text.length) {
      nodes.push(<span key="caret" className={styles.caret} aria-hidden="true" />)
    }
    if (hidden) {
      nodes.push(
        <span key={`h${i}`} className={styles.untyped}>
          {hidden}
        </span>,
      )
    }
    offset += segment.text.length
  })

  return <>{nodes}</>
}
