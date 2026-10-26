# Support and feedback audit

Reviewed on 2026-10-26. Changes are implemented in the working tree and have not been deployed.

The support system now uses private issue pages. `/support` lists a person's issues, `/support/new` creates an issue, and `/support/issues/[id]` holds its report, attachments, comments, and status events. Admins open the same conversation from their support inbox. Existing report buttons preserve the originating page and generation context.

| Finding | Result |
| --- | --- |
| Admin responses overwrote one note instead of creating a conversation | Added persistent messages with user, admin, and system roles. Historical private notes remain private. |
| A response only triggered email on the first transition to resolved | New replies notify the recipient independently of issue status. The reply is committed before email is attempted. |
| Email failures were hidden | Reply responses distinguish provider acceptance, failure, missing email configuration, and missing recipient. The admin composer explains these outcomes. Provider acceptance does not prove inbox delivery. |
| Users could not retrieve reports or reply | Added owner-authorized list, detail, reply, and close/reopen endpoints. Admins can access all issues. |
| Guest reporting was blocked by the authenticated frontend proxy | Added a narrowly scoped support proxy with optional authentication. Guests receive a signed issue-specific link, retained in their browser and included in receipt emails. |
| Analytics captured full page URLs, which would expose new guest access tokens | Support pages and the admin issue list block DOM capture. The analytics send hook drops support-page events and any event containing an access token. |
| Old status controls mixed closing, notes, and responding | Reply and close/reopen actions are separate. Status changes appear in the conversation. A user reply reopens a closed issue. |
| Closed issues could disappear from admin filters and counts | Closed and legacy resolved issues share the closed filter/count. In-progress issues count as unresolved. Title search is included. |
| Admin report tables and modal controls were unsuitable for phones | Replaced the report modal/table with linked issue rows. Added wrapping filters, a compact mobile admin section selector, consistent gutters, and touch-sized controls. Ratings use wrapping list entries. |
| Submission mixed basic reporting with too many controls | The main form asks for category and description. Title, investigation details, images, voice, and email are optional. Bug details include location, reproduction steps, and expected behavior. |
| Important context was absent or discarded | Persist optional bug details and generation context. Existing screenshot/audio attachments remain accessible. |
| AI enrichment controlled notification timing | Submission receipts and admin emails now run before optional enrichment. Fixed literal JSON in the AI summary prompt. |
| Repeated rating lookup could raise on multiple rows | Rating lookup selects an existing row without assuming only one row exists. |

The UI retains the site's Space Grotesk font, cream background, orange accent, dark zinc palette, and square border treatment. The post-generation star rating prompt remains separate from issue conversations.

## Validation

- Production Next.js build passed and includes all three support pages and the support proxy.
- TypeScript and ESLint checks passed for the changed support/admin implementation.
- Executable analytics-hook checks confirm support events and token-bearing referrers are dropped while ordinary page events are retained.
- Thirty support, email-auth, and OAuth tests passed. Nine support tests use an actual SQLite database and ASGI requests to check thread isolation, guest token scope, persisted replies, notifications, close/reopen events, optional context, legacy admin behavior, title search, and closed filters/counts. External email is stubbed.
- Luna through Brocode inspected the rendered support list and new-issue page at the available desktop viewport. Page-text verification passed. It did not submit issues, authenticate, or send messages.

## Deployment and verification limits

Apply Alembic revision `b6e4f2a8c910` with `alembic upgrade head` before serving the new backend. It adds optional report context and the `support_messages` table. The migration has a single head; it has not been applied to a deployed database during this work.

The backend Docker startup command already runs `alembic upgrade head` before Uvicorn. No separate manual migration command is needed for this container. The active GitHub deployment workflow targets the EC2 self-hosted runner. Its first deployment attempt stopped before building because `/opt/resumer` contained production-specific Compose and tunnel configuration that conflicted with `git merge`. The deployment workflow now builds backend source from the runner checkout while retaining `/opt/resumer` as its runtime configuration directory. Shell syntax and the merged Compose configuration were validated locally.

Real inbox delivery and attachment storage were not exercised. Verify the deployed Resend key, sender, frontend URL, and R2 configuration, then send a controlled test reply and follow its conversation link. Replies remain readable in the issue even when email fails. There is no automatic email retry queue.

Brocode could not resize its viewport, so phone rendering and the authenticated admin conversation were not browser-tested. Their responsive layout and permissions were reviewed in source; backend authorization was tested through the API. A phone check after deployment should cover submission, opening the receipt link, admin reply, user follow-up, and close/reopen.

Guest links expire after 90 days. Anyone holding a guest link can access that issue, so the conversation page uses a no-referrer policy and warns users to keep the link private. Historical overwritten responses cannot be reconstructed; old admin notes are deliberately not published as comments.

## Production follow-up

The first successful EC2 deployment did not guarantee correct public routing. A stale Azure `resumer-cloudflared-1` container was still connected to the same tunnel as EC2. Read-only diagnostics confirmed the EC2 container and its local API exposed conversation routes, while requests from Azure reached the old API exposing only report submission. The obsolete Azure tunnel connector was stopped and its restart policy disabled. Its backend and database were retained. Public OpenAPI subsequently exposed the new conversation routes.

Deployment health checks now require the conversation detail and reply routes in addition to the MCP authentication check. A read-only diagnostic workflow checks runtime routing and can read existing issues using an existing configured admin account without logging report contents or credentials.

The mobile native admin select was replaced with an in-page button menu using the site's palette, wrapping section buttons, active state, Escape dismissal, and focus restoration. Admin issue links retain their inbox navigation when a request fails. Failed requests include HTTP status instead of always suggesting that the admin needs to sign in. The support proxy also accepts null GitHub claims for non-GitHub accounts; three frontend proxy tests cover authenticated nullable claims, guest link forwarding, and restricted paths.

The admin close action later exposed a separate proxy defect: `/api/backend` exported GET, POST, PUT, and DELETE but omitted PATCH. Production requests returned 405 before reaching FastAPI. PATCH is now exported and covered by a frontend regression test that forwards the close/category payload. Admin issue updates also accept partial title/category changes, with validated categories and system events recording edits. Only admins can edit these fields; the original report body remains unchanged. The issue page provides a mobile-friendly edit form with category buttons, including Feature Request. Eleven backend support tests and four frontend proxy tests cover the updated behavior.
