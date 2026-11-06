# Professional Sans design and implementation plan

Implemented the backend `professional-sans` template as a separate option. Existing Personal Classic files are unchanged. Template-specific writing budgets are centralized in a versioned layout policy appended after configured database prompts are loaded, including for synthetic projects, project replacement (`resume_retailor.py`), and orphan repair.

## Layout and fonts

The trial at `/tmp/resumer-trial/generate.py` renders an A4 page with Arial at 9 pt, a centered 19 pt name, short contact links, section rules, and stacked experience headings. Its PDF is one page with embedded Arial fonts, but the generator omits subtitle and extracurriculars and hardcodes section order. It is useful visual evidence, not a complete capacity test.

The new template keeps that visual direction and supports the existing section-order mechanism and all six body sections. It uses a centered name at 2.1 times body size, contact text at body size, black ruled headings at body size, right-aligned experience dates, an italic organization line, two-column categorized skills, and short clickable project labels. It omits the profile subtitle, as the trial does. Single-column body text is left aligned. Entry blocks stay together across pages. Long ordinary headings can wrap.

The template explicitly declares A4 and symmetric 14 mm margins. Its body font range is 9–11 pt with 1.4 line height. Nine points is the dense option, not the preferred reading size. The renderer selects the largest fitting size in 0.05 pt steps. The name is 23.1 pt at the maximum and 18.9 pt at the minimum. There is no clipping, fixed-height container, or CSS scaling to conceal overflow.

Typography rules strictly ensure all non-name elements render in Arial:
- Code markup tags (`code`, `pre`, `kbd`, `samp`) explicitly declare `'Resume Sans', Arial, sans-serif` and `font-size: inherit` to prevent browser/rendering engine fallback to monospace fonts that inflate line widths.
- Anchor links (`a`) and block/inline text elements declare `overflow-wrap: anywhere;` to avoid horizontal overflow from long unbroken URLs or unbroken words without clipping or hiding text.
- Contact line spacing in `template.jinja2` uses whitespace stripping (`{%- ... -%}`) to maintain uniform single spaces around the ` | ` pipe separators regardless of conditional link or handle presence.

The unmodified Microsoft core-font installer is bundled with the template; the Docker image extracts its Arial regular, bold, italic and bold italic faces during build. For local development run `7z e -y -obackend/templates/professional-sans/fonts backend/templates/professional-sans/arial32.exe "*.TTF"` from the repository root. The extracted font files are ignored by Git. The installer was obtained from https://downloads.sourceforge.net/corefonts/arial32.exe. PDF inspection confirms embedded, subset, Unicode-mapped regular, bold, and italic faces; the bold italic file is available when content needs it.

The manifest caps generation at two bullets per project and experience and requests at most four skill categories. The template itself renders all supplied content, including manually added third bullets; it never silently deletes editor content.

## Measured capacity

Run from `backend`:

```sh
.venv/bin/python scripts/measure_professional_sans.py
```

The script uses WeasyPrint 69.0 and the actual registry, Jinja template, and shared fit helper, without database calls or LLM credits. It writes PDFs, input fixtures, and `measurements.json` to `/tmp/resumer-sans-design`. It renders eight content cases at seven fixed sizes, 9 through 12 pt in 0.5 pt increments, including two probes above the proposed maximum. It also auto-fits each case. Five cases reproduce the existing three-bullet content pressure; three budget cases retain the strongest first two bullets. Additional entries are explicitly fictional capacity fixtures.

| Fixture | Visible words including headings and metadata | Pages at 9 pt | Pages at 11 pt | Largest fitting font within 9–11 pt |
| --- | ---: | ---: | ---: | ---: |
| Original sample, 2 projects + 2 experiences, 3 bullets each | 471 | 1 | 2 | 9.35 pt |
| Concise copy, 2+2, 3 bullets each | 401 | 1 | 2 | 9.50 pt |
| Concise copy, 3+3, 3 bullets each | 553 | 2 | 2 | None |
| Longer copy, 3+3, 3 bullets each | 598 | 2 | 2 | None |
| Longer identities, second degree, expanded skills, 3+3, 3 bullets each | 590 | 2 | 2 | None |
| Budget copy, 2+2, 2 bullets each | 314 | 1 | 1 | 11.00 pt |
| Budget copy, 3+3, 2 bullets each | 423 | 1 | 2 | 9.05 pt |
| Longer identities, second degree, expanded skills, 3+3, 2 bullets each | 460 | 2 | 2 | None |

For the requested endpoint examples, the last text ends at 276.77 mm for 2+2 at 11 pt and 279.93 mm for 3+3 at 9 pt, measured from the page top. That leaves 6.23 mm and 3.07 mm before the bottom content boundary at 283 mm. The longer stress case requires two pages at 9 pt. These are text bounds, not promises that all future content will fit.

The successful endpoint examples retain all six sections, four skill categories with twenty skills, one degree, a 21-word summary, and one 16-word extracurricular item. Their bullets contain 20–23 words and 155–183 visible characters. The long stress case adds a second degree, a longer full name and email, a longer role and organization, and four additional skills.

### Horizontal overflow prevention and detection

To ensure unbreakable text does not overflow margins:
- CSS `overflow-wrap: anywhere;` is explicitly applied across `body`, `code, pre, kbd, samp`, `h1`, `h2`, `p, dl, dd`, `dt`, `li`, and `.skills-table td`. Text is never clipped or hidden with `overflow: hidden`.
- The renderer actively inspects WeasyPrint formatted box tree geometries (`TextBox.position_x + TextBox.width > right_bound` or `TextBox.position_x < left_bound`) via `check_horizontal_overflow`.
- If unbroken tokens or layout anomalies escape wrapping, the renderer rejects fitting at that font size, marks `fits_target = False`, and sets a fit warning.

## Centralized layout policy (v1)

A centralized, versioned policy (`PROFESSIONAL SANS LAYOUT POLICY v1`) is appended dynamically after database-backed prompts across all generation, replacement, and repair entry points:
1. `summary_node`: summary <=30 words; skills <=4 categories, roughly 20 concise skills total (~300 chars across values).
2. `experience_node`: exactly 2 distinct bullets per entry, 18–23 words and <=185 chars per bullet.
3. `project_node` & synthetic project path: exactly 2 distinct bullets per entry, 18–23 words and <=185 chars; short project summary (<35 chars).
4. `extracurricular_node`: at most one concise extracurricular item (<=20 words) in new generation.
5. `resume_retailor.py` (`replace_project`): retailored/replaced projects strictly inherit the template policy.
6. `orphan_repair_node`: repairs single-word overflow orphans while strictly preserving factual substance and bullet count without dropping entries.

### Policy precedence and creativity modes

The policy explicitly instructs the LLM:
- **Overrides:** The appended policy supersedes conflicting length/line-fit/bolding rules from older database prompts (such as "fill 1.75–1.95 rendered lines" or "generate 3-4 bullets").
- **Creativity modes respected:** Creativity modes (`proper`, `larp`, `super_larp`) operate normally within these length and count bounds. In `proper` mode, strict evidence and truth preservation rules apply ("never invent or pad", "without inventing keywords"). In `larp` and `super_larp` modes, evidence-only restrictions are omitted so embellishment rules remain active and unconflicted, while bullet counts and word targets remain strictly bounded.
- **Authoritative field preservation:** The pipeline and retailor services enforce non-destructive preservation of candidate role, organization, original dates (including `None` for current ongoing roles or projects without model-invented dates), project links, and education. Schema descriptions remain neutral across templates. Batch response validators raise retryable `InvalidStructuredOutput` when batch sizes are incomplete, and exhausted retries fall back non-destructively to source batch entries.
- **Skills expansion bounding:** Generation-only skill budgeting (`_apply_professional_sans_skill_budget` and `_ensure_jd_skill_coverage`) enforces consistent limits on both existing generated skills and JD injected skills: at most 4 categories, at most 20 skills, and approximately 300/320 characters across all skill values. Manual editor content is preserved without alteration.

## Project replacement isolation

When replacing a single project via `retailor_resume_with_project`:
- Only the targeted replacement project is submitted to the LLM and capped to `max_bullets` (2 for `professional-sans`).
- All untouched projects on the resume are preserved exactly as-is, retaining all candidate content including manually entered third bullets.
- If replacement tailoring encounters exhausted retries or structured output errors, the service falls back non-destructively to the raw replacement project.

## Non-destructive overflow path

When content overflows at the minimum font size (9 pt):
1. **No destructive bullet deletion:** Unlike older templates that pop bullets to force a 1-page fit, `professional-sans` avoids destructive bullet dropping.
2. **Compression disabled:** LLM compression is completely disabled for `professional-sans` to prevent accepting fabricated facts. Numerical token counts and secondary LLMs cannot reliably verify factual fidelity.
3. **Full content retention with fit warning:** When a document exceeds the page target at the minimum font size or exhibits horizontal overflow, the complete document is preserved across two pages, and an informative fit warning (`fits_target = False`) is returned to the user. Manual editor content and source achievements are never silently discarded.

## Orphan repair verification and rollback

Orphan repair rewrites awkward line wraps (single-word terminal lines):
- Snapshots of experiences, projects, extracurriculars, and `repair_history` are captured prior to repair.
- LLM output is validated against the batch schema.
- If repair fails, encounters parsing errors, if verification render is `None`, or if WeasyPrint raises any exception during layout verification, the pipeline rolls back completely to the pre-repair snapshot.
- Page budgets are never enforced by dropping entries or source data.

## Validation and test suite

- **Measurement suite:** `scripts/measure_professional_sans.py` verifies vertical and horizontal page bounds across 8 fixtures and 7 font sizes with exact bullet extraction checks.
- **Behavioral and regression test suite:** `backend/tests/test_professional_sans_policy.py` contains 26 comprehensive unit and integration tests covering:
  - Policy appending across all pipeline and retailor nodes.
  - Stale prompt override behavior across `proper`, `larp`, and `super_larp` modes.
  - Skills postprocessing budget enforcement in `professional-sans` and preservation in other templates.
  - Authoritative preservation of role, organization, null current `end_date`, links, and fallback on missing batch entries.
  - Non-destructive overflow path (full content preservation and warning on overflow without compression).
  - Project replacement isolation (untouched projects and 3rd bullets preserved).
  - Safe wrapping and horizontal overflow detection (`fits_target=False` when text overflows).
  - Orphan repair snapshot rollback on `None` verification render or error.
  - Typography rendering (non-name Arial, code tag styling, contact whitespace normalization).
- **Template preview image:** `frontend/public/images/templates/professional-sans.png` is generated and committed, matching the measured 2+2 sample at 11 pt.
- **Related test suites:** All existing template, preview, font fit, retailor, and synthetic project tests pass without regressions.
