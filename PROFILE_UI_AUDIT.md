# Profile page UI investigation

Date: 2026-11-03. Checkout reviewed: c173be6. Investigation only; no application code changed.

## Scope and evidence

Reviewed `/profile`, its page shell, section navigation, Basic Info, Experience, Projects, Education, Extracurriculars, PDF import, GitHub import preview, generation defaults, save status, and unsaved-changes dialog. Followed their queries, mutations, form state, and global CSS.

Evidence labels below distinguish source-confirmed behavior, a browser reproduction of the CSS mechanism, and risks requiring a running application to reproduce. Severity 3 means major, 2 means moderate, and 1 means cosmetic. Priorities are provisional, not user-test results.

The frontend dependencies are absent in this checkout. I did not run the signed-in profile page or change real profile records. An isolated Chrome reproduction used the repository's actual `pixel-enter` CSS and equivalent declarations for the responsive overlay. Its measured viewport was 500 × 757 below the desktop breakpoint, and 1440 × 913 above it. These are CSS mechanism checks, not a complete phone or desktop usability test. Actual device keyboards, touch scrolling, screen readers, dark-mode contrast, and the deployed build remain unverified.

## Why the background blur covers only the list

**Severity 3. Browser-reproduced mechanism and source-confirmed affected structure.**

Relevant source:

- `frontend/app/globals.css:867-874`: `pixel-enter` ends at `transform: translateY(0)` and uses `animation: pixel-enter 0.4s ease-in both`.
- `frontend/components/profile/ExperienceForm.tsx:319`: the entire section has `pixel-enter`.
- `frontend/components/profile/ExperienceForm.tsx:209-216`: its editor is a nested `fixed inset-0` overlay.
- The same structure occurs in `EducationForm.tsx:328`, `ExtracurricularForm.tsx:322`, and `ProjectForm.tsx:558`.

A transform of zero still counts as a transform. Because the animation retains its final state, the section remains a containing block for its fixed descendants after the animation finishes. `inset-0` consequently covers that section rather than the viewport. Its stacking context also contains the editor's z-index.

The backdrop blur operates only inside the misplaced overlay rectangle. Increasing the blur strength or the editor's z-index cannot correct this geometry.

The isolated browser check measured the overlay at x=12, y=240, height=240 when the parent list was 240px high. With a 1500px list, the overlay was 1500px high. With an explicitly empty parent, its height was zero. Disabling only the parent animation restored x=0, y=0 and the viewport's height. Width differences in the measurements include the browser scrollbar.

Practical consequences to verify on the real page:

- A short or empty list can produce a collapsed backdrop and a misplaced or clipped editor.
- A long list can position the bottom-aligned editor near the bottom of the list, beyond the visible screen.
- Scrolling can move the editor with its section.
- Header, defaults, import panel, and navigation outside the section do not receive the intended full-screen backdrop.

The list height also changes when opening Add because the toolbar is removed. This makes the geometry depend on the current content and editing state.

A later fix should place modal overlays outside transformed content, preferably through a shared body-level portal. The animation should affect the dialog panel rather than its full-screen backdrop. Removing the persistent transform addresses this particular trigger, but does not supply the other missing modal behavior described below.

## Desktop behavior is a separate design decision

**Severity 2. Source-confirmed; intended behavior needs a product decision.**

All four entry editors explicitly switch at `md`, 768px, to `position: static`, transparent background, no backdrop blur, and no height cap. Desktop Add inserts a form before the list; Edit inserts it after the selected card. This is deliberately encoded responsive behavior, rather than the mobile containment failure happening identically on desktop.

The isolated desktop check confirmed static positioning. If the desired desktop experience is a modal, the current implementation does not provide it. If inline editing is retained, it needs clear entry focus, scrolling to the editor, and protection against switching records while editing. Resizing across 768px with an editor open currently changes its interaction model.

## Other major findings

### 1. Mobile editors do not behave as complete modal dialogs

**Severity 3. Source-confirmed missing behavior.**

The ordinary entry editors have no body scroll lock, focus trap, initial focus, focus restoration, dialog role/name, background inertness, Escape handler, or backdrop dismissal. Their X buttons have no accessible name. The form has its own `overflow-y-auto`, but the document remains scrollable underneath.

References: `ExperienceForm.tsx:209-303` and the corresponding `renderForm` blocks in Education, Projects, and Extracurriculars. Project's scroll lock and Escape effect at `ProjectForm.tsx:142-159` apply only to the GitHub import preview, not the normal editor.

Impact: keyboard users can reach background controls, assistive technology has no modal boundary, and touch scrolling can affect the underlying page. A full implementation should define a consistent dismissal policy, particularly when edits are unsaved or saving.

### 2. Navigation can appear above the entry editor

**Severity 3. Source-confirmed stacking structure; visual overlap needs full-page confirmation.**

Global Nav is `sticky ... z-50` at `Nav.tsx:121`; profile tabs are `sticky top-0 z-20` at `ProfileClient.tsx:113`. The editor's z-50 is trapped inside the animated section's stacking context. It cannot outrank those outer contexts by increasing its own z-index.

Separately, both mobile navigation rows stick to top=0, so the global navigation can cover the profile section tabs when scrolling. The tab bar needs an offset matching the actual global navigation height, or an intentional single sticky navigation layout.

### 3. Autosave can mark changes that were never sent as saved

**Severity 3. Source-confirmed race path; delayed-request reproduction pending.**

The four entry forms send a snapshot of form values. Their success handlers then call `reset(getValues())`, which reads the values present when the request finishes, not the submitted snapshot. Inputs remain editable while saving.

Reproduction to run later: edit text A; let autosave start; type text B while the request is pending; resolve the request that saved A. The success callback can mark B clean, remove its local draft, and stop the next autosave. The UI reports saved while the server holds A.

References: `ExperienceForm.tsx:107-120,158-176`, matching success handlers in Education, Projects, and Extracurriculars. Basic Info instead resets to the response at `BasicInfoForm.tsx:101-123`, which can overwrite text typed during the request.

Save state must track the submitted revision and preserve changes made after that revision.

### 4. Cancel and Discard do not reliably mean undo

**Severity 3. Source-confirmed save/cancel semantics.**

A valid entry is persisted after five seconds of inactivity, even during Add. Cancel resets the editor state but does not undo that saved change or delete a newly created entry. The title can change from Add to Edit after background creation. A subsequent unsaved-changes prompt can discard only edits made after the last save, not the entire editing session.

References: `ExperienceForm.tsx:75-81,107-120,158-171`, shared by the other entry forms; `ProfileClient.tsx:87-95`.

Decide whether the editor saves continuously or stages changes until confirmation. Then align button labels and dismissal behavior with that decision. A fresh empty Add form also initially displays "All changes saved" because clean state is treated as saved state.

### 5. Closing during an in-flight save is not consistently guarded

**Severity 3. Source-confirmed controls; resulting races need runtime verification.**

The footer Cancel button is disabled while saving, but the header X remains enabled. Desktop record edit/delete controls and profile section tabs also remain active. A save callback can therefore arrive after the user has closed the editor or started a different record.

References: `ExperienceForm.tsx:225-233,284-300,373-394`; `ProfileClient.tsx:49-70,121-123`. The latter sets `isSaving`, but does not disable tab clicks. Rapid tab switching can start multiple saves or resolve navigation in an unexpected order. A first create request overlapping another save may also run before the new record ID is adopted.

The later implementation should define which actions remain available while saving and scope responses to the record and edit revision that produced them.

### 6. Failed reads and deletes have no useful recovery UI

**Severity 3. Source-confirmed missing error branches.**

The entry queries default their data to empty arrays and render only a loading branch. They do not render query errors. A failed initial load therefore ends in a zero-entry view rather than a failure message with retry. Basic Info similarly does not handle its profile query error. Delete mutations invalidate on success but expose neither pending nor error status.

References: `ExperienceForm.tsx:53-61,177-188,306-315`; equivalent query/delete paths in the other entry forms; `BasicInfoForm.tsx:47-55,182-193`.

Save failures receive a generic badge, but the forms do not pass a specific error explanation into it. Users cannot distinguish validation, authentication, connection, or server failures.

### 7. Leaving the profile can lose unsaved edits

**Severity 3. Source-confirmed navigation gap.**

`ProfileClient.tsx:37-47` guards refresh/close with `beforeunload`. Its custom save/discard handling runs only for profile section buttons. Next.js navigation through Nav links is not covered by that handler. Local draft writes do not provide recovery: a repository search found writes/removals for `resumer_draft_*`, but no reads that restore those drafts.

References: `ProfileClient.tsx:37-70`; draft effects and save handlers in all five forms. Defaults also maintain independent unsaved state and never register it with ProfileClient.

## Layout and accessibility findings

### 8. Mobile editor headers have no robust narrow-width layout

**Severity 2. Source-confirmed constraints; exact overflow needs rendered-page testing.**

Each header places an uppercase title and a wide save badge in one flex row, alongside X, without a wrapping or stacked layout. The badge can expand further to include "Unsaved changes" and "Save Now" or "Error saving" and "Retry". Basic Info uses a similar title/badge row.

References: `ExperienceForm.tsx:218-233`; `SaveStatusBadge.tsx`; `BasicInfoForm.tsx:196-204`.

Check 320, 360, and 390px widths, all save states, and enlarged text. The solution should allow the status to use a second row rather than squeeze the title or close action.

### 9. Long content has incomplete wrapping protection

**Severity 2. Source-confirmed constraints; visual severity pending.**

Cards set `min-w-0`, but long unbroken titles, organization names, technologies, and bullet text lack an explicit wrapping strategy. The desktop grid uses `13rem 1fr` without `minmax(0,1fr)` or an explicit minimum-width reset on the main panel. Long content may expand the grid or spill out of cards.

References: `ProfileClient.tsx:111,140`; card content in each entry form, for example `ExperienceForm.tsx:350-371` and `ProjectForm.tsx:1001-1038`.

Projects also clamp mobile descriptions to two lines without a read-more control. Confirm whether editing is intended to be the only way to inspect a longer description.

### 10. Long forms have weak access to primary actions

**Severity 2. Source-confirmed layout; phone keyboard behavior pending.**

Headers and Save/Cancel actions are inside the same scrolling form, with no sticky action region. Project forms are particularly long. Once scrolled into the middle, both close and save can be out of view. There is no explicit bottom safe-area padding. `90dvh` is a useful height choice but is not proof that focus and actions remain accessible above a real phone keyboard.

References: the `renderForm` wrappers in all four entry forms. Test a real touch keyboard, landscape, reduced viewport height, and scrolling at both ends of the form.

### 11. Section navigation and status changes are not conveyed accessibly

**Severity 2. Source-confirmed markup.**

Profile section buttons expose neither selected state nor a relationship to their content. Use either a proper tab pattern with its keyboard behavior or a clearly labeled navigation pattern with an appropriate active-state attribute. SaveStatusBadge has no live status region. Validation messages are rendered visually without input `aria-invalid` or an association through `aria-describedby`. Defaults +/- controls lack names identifying which setting they change.

References: `ProfileClient.tsx:115-135`; `SaveStatusBadge.tsx`; `ExperienceForm.tsx:237-257`; `DefaultsSection.tsx:24-46`.

### 12. Existing portaled dialogs only partially solve modal behavior

**Severity 2. Source-confirmed implementation differences.**

GitHub import preview and UnsavedModal already portal to `document.body` and lock scrolling. This shows the repository has a partial solution to the containment issue, but normal entry forms do not use it. Neither dialog implements full focus management or dialog semantics. The GitHub preview opens while its underlying form is also mounted, producing two editor layers on mobile.

References: `ProjectForm.tsx:142-159,875-997`; `UnsavedModal.tsx:25-104`. Consolidate modal behavior instead of copying any one of these implementations unchanged.

### 13. Imports can conflict with manual editing and section changes

**Severity 2. Source-confirmed ownership and reset paths; runtime reproduction pending.**

PDF import state belongs to ResumeImportPanel. It is shared across non-Project sections, but removed when Projects is selected, so a staged draft or in-progress UI is lost on that transition. There is no import-specific navigation guard. Applying import invalidates profile queries while manual editing may be in progress; Basic Info's reactive `values: profile` can reset local fields when that data changes.

GitHub import populates the manual form with `setValue` calls that do not explicitly request dirty-state updates. Test preview > Edit > switch section without typing, because the dirty guard may not recognize the staged imported values.

References: `ProfileClient.tsx:141-145`; `ResumeImportPanel.tsx:26-104`; `BasicInfoForm.tsx:62-78`; `ProjectForm.tsx:341-364`.

## Suggested order for later fixes

1. Fix overlay ownership and stacking across all four entry sections. Decide whether desktop keeps inline editing or uses a modal.
2. Supply shared modal behavior: focus, background interaction, scrolling, dismissal, and an accessible name.
3. Resolve save semantics and revision handling before making Cancel/Discard promises in the UI. Protect against stale responses and concurrent navigation.
4. Add visible query/delete failure and retry states, and handle profile navigation and draft recovery.
5. Tune sticky navigation, narrow headers, long text, action placement, and accessible status/validation markup.
6. Verify PDF/GitHub import transitions alongside dirty manual forms.

## Acceptance checks for the implementation phase

- All four entry sections: Add and Edit, with zero, one, and many existing entries, at top and mid-scroll.
- Widths 320, 360, 390, 767, 768, 1024, and 1440px. Cross 768px while editing. Test short landscape viewports too.
- A modal backdrop covers the visible viewport and blocks background interaction. Opening it does not move the background page.
- Focus enters the editor, stays inside a modal, and returns to a sensible trigger when closed. Escape/dismissal follows the agreed unsaved-edit rules.
- Save, Cancel, X, backdrop, tab switch, Nav links, browser Back, refresh, and close all have defined results.
- A delayed save followed by more typing preserves newer edits and does not claim they were saved prematurely.
- Rapid save/tab/edit actions do not create duplicate records or apply stale callbacks to another record.
- Initial load failure, save failure, delete failure, and authentication expiry have visible recovery paths.
- Empty Add, validation errors, unsaved, saving, saved, and retry badge states fit at narrow widths and enlarged text.
- Long names, URLs, technologies, and bullets do not create page-level horizontal scrolling.
- Real phone keyboard and bottom safe area leave every field and primary action reachable.
- PDF import and GitHub preview transitions preserve staged work or clearly explain its dismissal.
- Light/dark appearance, reduced motion, keyboard navigation, and screen reader announcements receive a live check.
