"use client"

import Link from "next/link"
import { Check, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useOnboardingSteps, useUpdateOnboarding } from "@/lib/onboarding"

/**
 * Dashboard "Getting started" checklist. Steps tick themselves off from real
 * data; Hide is stored on the account so it stays hidden on every device.
 */
export function GettingStarted() {
  const { active, steps, current, doneCount } = useOnboardingSteps()
  const update = useUpdateOnboarding()

  if (!active) return null

  return (
    <section aria-labelledby="getting-started-title" className="overflow-hidden rounded-md border border-line bg-paper">
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5 sm:px-6">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-ink-faint">New here</p>
          <h2 id="getting-started-title" className="text-base font-bold tracking-tight text-ink sm:text-lg">
            Getting started
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-xs font-semibold text-ink-muted" aria-label={`${doneCount} of ${steps.length} steps done`}>
            {doneCount} of {steps.length}
          </span>
          <Button variant="ghost" size="xs" onClick={() => update.mutate({ dismissed: true })}>
            Hide
          </Button>
        </div>
      </div>

      <div className="h-0.5 bg-ink/[0.06]" aria-hidden="true">
        <div className="h-full bg-ink/60 transition-[width] duration-500" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>

      <ol className="divide-y divide-line">
        {steps.map((step, i) => {
          const isCurrent = current?.id === step.id
          return (
            <li
              key={step.id}
              className={`flex flex-wrap items-center gap-x-3.5 gap-y-3 px-5 py-3.5 sm:flex-nowrap sm:px-6 ${isCurrent ? "bg-ink/[0.025]" : ""}`}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span
                aria-hidden="true"
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${
                  step.done
                    ? "border-line-strong text-ok"
                    : isCurrent
                      ? "border-ink text-ink"
                      : "border-line text-ink-faint"
                }`}
              >
                {step.done ? <Check size={13} strokeWidth={3} /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold ${step.done ? "text-ink-muted line-through decoration-ink/20" : "text-ink"}`}>
                  {step.title}
                  <span className="sr-only">{step.done ? " (done)" : isCurrent ? " (next)" : ""}</span>
                </p>
                {!step.done && (
                  <p className={`mt-0.5 text-xs text-ink-muted ${isCurrent ? "" : "hidden sm:block"}`}>{step.hint}</p>
                )}
              </div>
              {isCurrent && (
                <Link href={step.href} className="shrink-0 basis-full pl-[2.375rem] sm:basis-auto sm:pl-0">
                  <Button size="sm" variant="secondary" className="w-full shadow-none sm:w-auto">
                    {step.cta}
                    <ArrowRight size={14} aria-hidden="true" />
                  </Button>
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
