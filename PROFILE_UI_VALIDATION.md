# Profile UI validation

Date: 2026-11-03. Tested the production frontend build at localhost:3000 through the browser-only SOCKS mapping to port 3100, with the local backend and isolated PostgreSQL database. The saved Google account authenticated normally. Test records and profile values were written only to the isolated database. Reproducible Playwright scripts and logs are in `/tmp/resumer-profile-validation`; they attach to the visible persistent Chrome session.

## Current result

**Fixed and verified — import controls remain locked during apply.** A deterministic PDF extraction fixture staged a draft, and the apply request was held before reaching the real backend. Discard, Skip, Upload, the file input, and the underlying Basic Info field were disabled; the draft remained visible and no discard confirmation appeared. One request was sent during the pending attempt. An injected failure retained the draft and unlocked the controls; a retry sent one further request to the real backend, applied the fixture location, and persisted it after reload. Script and log: `/tmp/resumer-profile-validation/apply-final.js` and `apply-final.log`.

**Passed:**

- Create and edit one record in each of Experience, Projects, Education, and Extracurriculars. For each, reload confirmed the saved edit; dirty Cancel followed by reopening retained the original server value. An Experience new form did not autosave after 6.2 seconds. Delete failure was injected for a project, the error appeared, and Try again deleted it through the real backend.
- Basic Info explicit save survived reload. Dirty section navigation offered Save & Continue and saved the value. A separate dirty switch offered Discard Edits. An Experience new draft survived reload and could be restored; a draft for an existing Experience record did not appear for another record or a new record and restored correctly for its original record.
- A delayed real Experience save sent one POST; form inputs and Cancel were disabled while pending. The close button could not be clicked while its enclosing fieldset was disabled; the test script logged a timeout for that attempted click, which is evidence of the lock rather than a product failure. An injected save failure retained input and a second save succeeded. Injected Experience and Defaults read failures displayed recovery UI and Try again loaded real data. Defaults mode saved and persisted after reload.
- At widths 320, 390, 767, 768, and 1440, the Experience dialog covered the viewport, locked body scrolling, placed focus inside, trapped Shift+Tab, and Escape closed a clean editor and restored focus. Forward Tab remained inside at desktop width. A mobile Project form scrolled to its Save action. A short dark-mode dialog was inspected. With five Experience records including an unbroken 180-character role and 400-character bullet, no page-level overflow occurred at 320, 390, or 1440; dialog bounds covered the viewport and a background wheel did not move the page.
- PDF extraction was replaced by deterministic `/import/start` and `/import/status` fixtures. The staged draft survived Basic Info → Projects → Experience → Basic Info. An injected apply failure retained manual Basic Info edits and the import draft. Retrying with the real backend applied an imported subtitle to an empty field and the visible Basic Info value refreshed immediately without reload. This does not test live PDF parsing or AI.
- A deterministic GitHub extraction fixture opened the top-layer review dialog; Edit populated the manual editor, whose dirty Cancel prompted discard. A second staged import saved through the real backend and survived reload. This does not test live GitHub extraction or AI.

- A project with a long unbroken name, technology token, and bullet was saved, edited, and reloaded from the real backend. With four saved projects, at widths 320, 390, and 1440, page and measured main/section/article containers had no horizontal overflow. From a mid-scroll position, the project dialog covered the viewport, Save was reachable, Tab and Shift+Tab stayed inside, and Escape closed it. Scripts: `project-final.js` and `layout-back-final.js` in the validation directory. The first project script's final mobile button locator failed after it had verified persistence; the separate layout script completed the responsive checks.
- Dirty Basic Info navigation through the Dashboard link preserved the text and profile route when the confirmation was rejected, and navigated when accepted. Browser Back across the document boundary showed Chrome's beforeunload confirmation; dismissing it preserved the profile and dirty value. Scripts: `outstanding.js` and `back-final.js`.
- An injected Defaults save failure showed “Could not save defaults. Please try again.” A second save reached the backend successfully. Script and log: `outstanding.js` and `outstanding-retry.log`.

**Limits:** PDF and GitHub extraction used deterministic fixtures, so these are frontend import UI checks, not live AI or parsing tests. No physical touch device, phone keyboard, or screen reader was tested. Cross-account draft isolation and every failure path in every section were not exercised. Build, TypeScript, and lint were reported passing by the parent on the final code; they were not rerun in this browser pass.

## Screenshots

Inspected final import busy state and project dialogs, plus earlier desktop and mobile screenshots:

- `/tmp/resumer-profile-validation/import-busy-final.png`
- `/tmp/resumer-profile-validation/project-dialog-final-1440.png`
- `/tmp/resumer-profile-validation/project-dialog-final-390.png`
- `/tmp/resumer-profile-validation/final-desktop-current.png`
- `/tmp/resumer-profile-validation/final-mobile-current.png`
- Additional dialog screenshots: `/tmp/resumer-profile-validation/desktop-experience-dialog.png`, `/tmp/resumer-profile-validation/mobile-experience-dialog.png`, `/tmp/resumer-profile-validation/mobile-project-dialog.png`, `/tmp/resumer-profile-validation/mobile-dark-short-dialog.png`.

## OAuth setup history

An initial direct localhost:3100 sign-in failed with `redirect_uri_mismatch`. The authorized localhost:3000 browser-only proxy mapped to the isolated frontend, and normal Google sign-in succeeded. The earlier OAuth blocker and shared-window blocker are resolved for this run; no auth bypass was used. The frontend, backend, proxy, and database remain running; browser profile and cookies were preserved.
