# Agent Hero — Orange Fluid Treatment

**Date:** 2026-11-03
**Status:** Approved design, pending implementation
**Worktree:** `pulse-alpha-free` (named after the model)

## Intent

The `/agent` page hero ("Connect your agent") is the first thing users see on
the connect flow, and it is visually dead: cream background, a hard-bordered
white card, and a solid button. The landing page already has a signature look —
a fully orange fluid field. This change ports that language to the agent hero
and gives the prompt a pull-quote treatment.

## Goals

- Hero section is completely orange, matching the main page hero (`FluidField`
  orange canvas: radial-gradient base, drifting ember/amber blobs, silk sheen,
  weave texture).
- The prompt pane becomes a **glass pane** (frosted translucent surface).
- The prompt text is set in **italics**, wrapped in **large decorative
  quotation marks** (pull-quote style).
- The "Copy prompt" button becomes a **glass button** underneath the pane.
- A very subtle **rectangular pulse**: a white, soft-edged, rectangle-shaped
  glimmer that emanates from the center and expands toward the edges. It must
  read as a glimmer/glitter on a surface — blurred, smooth, never a literal
  sharp rectangle.
- Only the hero changes. Every other part of the site is untouched.

## Non-goals / anti-goals

- No changes to the "How to get started" steps, the footer, nav behavior, or
  any other page.
- No canvas/WebGL, no SVG turbulence. CSS-only, consistent with the existing
  `fluid-*` implementation.
- No new content (no new headings, no marketing copy). The hero keeps its
  current content: the prompt, the copy button, the status line.

## Constraints

- Tailwind CSS v4 + existing `globals.css` `fluid-*` patterns; GPU-composited
  transforms only; respect `prefers-reduced-motion`.
- Dark mode must remain coherent (the fluid field already has dark tokens).
- The hero must remain accessible: the `sr-only` h1 stays, the copy button
  keeps its accessible name and `role="status"` feedback.

## Approaches considered

1. **CSS-only pulse layered on the existing fluid field (chosen).** Reuse
   `FluidField`, add a new `rectangular-pulse` shimmer block in `globals.css`:
   a heavily blurred, low-opacity white rounded-rectangle layer animated with
   `transform: scale()` + `opacity` (compositor-only), expanding from the
   center past the edges and fading out, plus a faint tiled sparkle layer
   (tiny radial-gradient dots) masked to the same expanding rect so the glint
   shimmers like glitter on a surface. Cheap, smooth, matches the codebase.
2. Canvas/WebGL glitter particles — rejected: heavier, non-deterministic,
   overkill for a background accent, and out of character with the CSS-only
   landing hero.
3. SVG `feTurbulence` noise shimmer — rejected: expensive on large areas and
   reads as film grain/noise rather than a subtle glimmer.

## The design

### Hero shell (`ConnectClient.tsx` / `page.tsx`)

- Hero section: `position: relative; overflow: hidden`, keeps
  `min-h-[calc(100svh-2.75rem)]`, drops the `#fbfbf3` cream background in
  favor of the fluid canvas.
- `<FluidField />` rendered as the orange backdrop (same component and props
  as the landing hero).
- Content sits above the field in a centered column: glass pane → glass
  button → status line.

### Rectangular pulse (globals.css)

New `.rectangular-pulse` layer inside the hero:

- A large, low-opacity, heavily blurred white rounded-rect (large radius so it
  never reads as a hard rectangle) centered in the hero.
- Animated with compositor-only `scale` + `opacity`: starts small at the
  center (opacity 0), brightens mid-way, expands toward the edges while
  fading to 0. Long duration (~6–8s), `ease-in-out`, infinite; staggered
  second ring optional if it reads well — but keep it *very subtle*.
- A second `.rectangular-glint` layer: tiled micro-dots (tiny radial
  gradients) whose background-position drifts while masked by a radial/rect
  mask that expands with the pulse, so the surface glints like glitter.
- `@media (prefers-reduced-motion: reduce)`: both layers static or hidden.

### Glass pane

- `backdrop-blur`, translucent white surface (light) / translucent dark
  surface (dark), hairline border, soft shadow — reusing the glass language
  of the landing hero nav (`bg-white/70` / `dark:bg-black/60` + blur), tuned
  for a larger surface.
- Prompt text: italic, `--fluid-ink` colored, with two large decorative
  quotation-mark glyphs (opening above-left, closing below-right, or flanking
  the block) in a translucent `--fluid-ink`/amber tone.
- `selection` styling keeps the ember selection color.

### Glass button

- Same glass treatment as the pane, pill or sharp per existing button
  language (current button is sharp-cornered — keep sharp corners to match
  the design system's brutalist edges): translucent fill, hairline border,
  blur, hover brightens. Keeps `Check`/`Copy` icons, `h-14 w-full` sizing,
  `onClick` copy behavior and the "Copied" state.

### Unchanged

- Copy logic, prompt generation (`agentPrompt`), sr-only h1, status line
  behavior, steps section, footer, nav, all other pages.

## What's left to the implementer

- Exact easing curves, durations, blur radii, and opacities for the pulse —
  tuned visually in-browser until it reads as "very subtle".
- Whether the sparkle layer ships if it can't be kept subtle (drop it rather
  than ship noise). The blurred rectangular pulse is the requirement; the
  glitter glint is the enhancement.
- Dark-mode token tuning for the pane border/quote glyphs.
