# ChatGPT connector launch runbook

| Field | Value |
|-------|-------|
| Document | ChatGPT connector submission and operations guide |
| Target app | Resumer (`Resumer MCP Server`) |
| Endpoint protocol | Remote MCP (Streamable HTTP / SSE) |
| Author | Resumer Core Team |
| Status | Ready for submission execution |

This document is a linear runbook for submitting the Resumer MCP server to the OpenAI ChatGPT app directory. Follow each step in order from top to bottom.

---

## Part 1. OpenAI Platform setup and verification

Before submitting an app, your OpenAI organization must meet verification and permission requirements.

### 1.1 Account and organization setup
1. Navigate to [OpenAI Platform](https://platform.openai.com) and log in.
2. Select your target organization from the top-left organization switcher.
3. Open **Settings** > **Organization**.
4. Check data residency. Ensure your project is set to **Default / Global**. Organizations or projects restricted to **EU data residency** cannot submit apps to the public ChatGPT directory. If your organization is set to EU data residency, create a global project for public directory apps.

### 1.2 Organization verification
1. Open **Settings** > **Organization** > **Verification**.
2. Complete either **Individual verification** or **Business verification**:
   - For individual verification, submit government ID verification via OpenAI's identity flow.
   - For business verification, provide your registered legal entity name, address, tax ID or business registry documentation, and domain verification.
3. Wait for verification status to display as **Verified** before proceeding to the submission portal.

### 1.3 Role and permission check
1. Open **Settings** > **Team**.
2. Locate your member record and confirm your role:
   - You must hold the **Owner** role, or an administrative role with the `api.apps.write` permission.
   - Reader or developer-level seats without app write scopes cannot submit new connectors or publish approved apps.

---

## Part 2. Submission materials

Use the pre-written fields below directly when filling out the submission form.

### 2.1 Basic app metadata

- **App name**: Resumer
- **Logo specification**: Square PNG, 512x512 pixels minimum, transparent-safe background, legible at 32x32 pixel sizes.
  - *Status*: `TODO-asset: logo not yet created`. Prepare `resumer-icon-512.png` prior to submission.
- **Short description** (148 characters):
  Tailor single-page, ATS-optimized resumes from your career profile and job descriptions. Edit bullet points, check layout fit, and export clean PDFs.
- **Long description**:
  Resumer connects your career profile to ChatGPT to generate targeted, ATS-optimized resumes tailored to specific job postings.

  What you can do:
  - Check profile readiness and spot missing sections before applying.
  - Generate single-page resumes tuned to job requirements and company context.
  - Maintain a database of projects, work experience, education, and skills.
  - Surgically edit tailored resume bullets and sections without starting over.
  - Detect typography orphans and page overflow issues before compiling.
  - Download production-ready PDF resumes directly from chat.
- **Category suggestion**: Productivity, Career
- **Company URL**: `https://<frontend-host>` (configured in `frontend/.env.example` as `AUTH_URL`, typically your custom domain or Vercel production deployment)
- **Privacy policy URL**: `https://<frontend-host>/privacy` (hosted at `frontend/app/privacy/page.tsx`)
- **Terms of service URL**: `https://<frontend-host>/terms` (or company root `https://<frontend-host>`)

### 2.2 Server and authentication configuration

- **MCP server URL**: `https://<backend-host>/mcp`
  - *Source setting*: Set to the production Railway backend URL. In frontend, this matches `NEXT_PUBLIC_MCP_URL`. In backend, this matches `BACKEND_URL`.
- **Protocol**: Remote MCP over Streamable HTTP and Server-Sent Events (SSE).
- **Authentication method**: OAuth 2.0 / OAuth 2.1 with PKCE (`S256`).
- **Dynamic client registration**: Enabled (RFC 7591).
- **Discovery endpoints**:
  - Authorization server metadata: `https://<backend-host>/.well-known/oauth-authorization-server`
  - Protected resource metadata: `https://<backend-host>/.well-known/oauth-protected-resource`
  - OpenID configuration: `https://<backend-host>/.well-known/openid-configuration`
- **Supported scopes**: `profile:read profile:write resume:generate resume:edit offline_access`

### 2.3 Tool annotation justification table

OpenAI requires safety annotations and a brief justification for every tool exposed by the MCP server. Resumer exposes 27 tools. The table below matches the exact annotations implemented in `backend/src/mcp/server.py`.

| Tool Name | readOnlyHint | destructiveHint | openWorldHint | Justification |
|-----------|--------------|-----------------|---------------|---------------|
| `get_profile` | True | False | False | Reads the authenticated user's profile data without modifying state or accessing external services. |
| `list_data_summary` | True | False | False | Reads section counts and data completeness metrics for the authenticated user without making changes. |
| `update_profile` | False | False | False | Updates contact information, summary, and skills for the authenticated user's profile. |
| `add_project` | False | False | False | Inserts a new project record into the authenticated user's profile database. |
| `update_project` | False | False | False | Updates fields on an existing project record owned by the authenticated user. |
| `delete_project` | False | True | False | Permanently removes a project record from the authenticated user's database. |
| `add_experience` | False | False | False | Inserts a new work experience entry into the authenticated user's profile. |
| `update_experience` | False | False | False | Updates fields on an existing work experience record owned by the user. |
| `delete_experience` | False | True | False | Permanently removes a work experience entry from the authenticated user's profile. |
| `add_education` | False | False | False | Inserts an education entry into the authenticated user's profile. |
| `update_education` | False | False | False | Updates an existing education entry owned by the authenticated user. |
| `delete_education` | False | True | False | Permanently removes an education record from the authenticated user's profile. |
| `add_extracurricular` | False | False | False | Inserts an extracurricular or leadership record into the user's profile. |
| `update_extracurricular` | False | False | False | Updates an existing extracurricular record owned by the authenticated user. |
| `delete_extracurricular` | False | True | False | Permanently removes an extracurricular activity record from the user's profile. |
| `list_templates` | True | False | False | Reads template definitions and permitted content splits from the static template registry. |
| `check_readiness` | True | False | False | Evaluates whether stored profile data satisfies template constraints without saving modifications. |
| `generate_resume` | False | False | False | Creates a tailored generation record and runs the resume compilation pipeline for a job description. |
| `set_generation_defaults` | False | False | False | Updates the user's default creativity mode and preferred section counts for future runs. |
| `get_generation_status` | True | False | False | Polls execution status, node logs, and completion state for a specified generation run. |
| `download_resume` | True | False | False | Generates a time-limited HMAC download link and returns structured resume JSON for a completed generation. |
| `get_resume_json` | True | False | False | Retrieves the tailored resume JSON structure or a specific section for an existing generation. |
| `edit_resume_section` | False | False | False | Surgically mutates a section or bullet point in a tailored resume's stored JSON metadata. |
| `preview_resume` | True | False | False | Runs Jinja HTML rendering and WeasyPrint box layout calculation to verify single-page fit without writing changes. |
| `detect_orphans` | True | False | False | Inspects layout boxes to report short trailing lines and multi-page overflow without modifying content. |
| `render_resume` | False | False | False | Recompiles resume JSON into a PDF with binary font search and updates object storage. |
| `save_resume_edits` | False | False | False | Persists edited resume content, re-renders the final PDF artifact, and updates Cloudflare R2 storage. |

### 2.4 Test prompts and tool sequences

Provide these 5 test prompts to the OpenAI review team to verify tool workflows.

#### Test Prompt 1. Generate a tailored resume
- **User prompt**:
  "Here is a job posting for a Senior Backend Engineer at Acme Corp: [paste job text]. Check if my profile is ready, then generate a tailored resume using the personal-classic template."
- **Expected tool call sequence**:
  1. `check_readiness(template_id="personal-classic", job_description="...")`
  2. If readiness returns missing fields, the model prompts the user or suggests profile updates.
  3. `generate_resume(job_description="...", template_id="personal-classic", company="Acme Corp", job_title="Senior Backend Engineer")`
  4. Model displays the resulting PDF download link and a brief summary of how bullets were targeted to Acme Corp.

#### Test Prompt 2. Add profile experience and project
- **User prompt**:
  "Add a new project to my profile called CloudScale. It is a distributed cache written in Go and Redis with 10k stars. Also add my current role as Staff Engineer at TechCorp from Jan 2023 to Present."
- **Expected tool call sequence**:
  1. `add_project(name="CloudScale", technologies=["Go", "Redis"], description="Distributed cache", bullet_points=["Engineered distributed cache in Go and Redis with 10k stars."])`
  2. `add_experience(role="Staff Engineer", organization="TechCorp", start_date="2023-01-01", end_date=None, bullet_points=["Leading backend infrastructure initiatives."])`
  3. `list_data_summary()` to confirm the updated counts.

#### Test Prompt 3. Check readiness and list templates
- **User prompt**:
  "What templates are available, and is my profile ready to build a resume for a Frontend Lead role?"
- **Expected tool call sequence**:
  1. `list_templates()`
  2. `check_readiness(template_id="personal-classic", job_description="Frontend Lead role requiring React and TypeScript")`
  3. Model summarizes available templates, current profile completeness score, and any missing sections.

#### Test Prompt 4. Edit a resume section
- **User prompt**:
  "On my latest resume generation [generation_id], update the professional summary to highlight 8 years of cloud architecture experience, check for orphan lines, and re-render the PDF."
- **Expected tool call sequence**:
  1. `get_resume_json(generation_id="<generation_id>", section="summary")`
  2. `edit_resume_section(generation_id="<generation_id>", path="summary", operation="set", value="Architect with 8 years of cloud experience...")`
  3. `detect_orphans(generation_id="<generation_id>")`
  4. `render_resume(generation_id="<generation_id>")`
  5. Model returns the re-rendered PDF download link and confirms line fit.

#### Test Prompt 5. Download a generated resume
- **User prompt**:
  "Give me the download link and structured JSON for resume generation [generation_id]."
- **Expected tool call sequence**:
  1. `download_resume(generation_id="<generation_id>")`
  2. Model provides the markdown link `[Download Resume (PDF)](download_url)` and summarizes the tailored sections.

---

## Part 3. Submission walkthrough

Execute these steps in the OpenAI Platform portal to submit the connector.

### 3.1 Open the app submission portal
1. Go to [platform.openai.com](https://platform.openai.com).
2. Open **Apps** or **ChatGPT Connectors** management from the navigation bar.
3. Click **Create App** or **Add Connector**.

### 3.2 Configure server and authentication
1. Select **Remote MCP Server** as the integration type.
2. Enter the MCP Server URL: `https://<backend-host>/mcp`.
3. Select **OAuth 2.0 / 2.1** as the authentication type.
4. Enable **Dynamic Client Registration** (DCR). The portal will discover metadata via `https://<backend-host>/.well-known/oauth-authorization-server`.
5. Enter the authorization scope string:
   `profile:read profile:write resume:generate resume:edit offline_access`.
6. Click **Discover Server**. The portal will connect to your endpoint and scan all 27 tools. Verify that all 27 tools appear with correct parameter definitions.

### 3.3 Complete app metadata and safety declarations
1. Fill in App Name, Short Description, Long Description, and Category using the values from Part 2.
2. Upload the square 512x512 logo.
3. Paste the Company URL (`https://<frontend-host>`) and Privacy Policy URL (`https://<frontend-host>/privacy`).
4. Paste the 27 tool justifications from the annotation justification table in Section 2.3 into each corresponding tool entry.
5. Provide the 5 test prompts from Section 2.4 into the review instructions box.
6. Provide test account credentials or reviewer access instructions (see Section 4.1).

### 3.4 Submit for review
1. Check all policy confirmation boxes (OpenAI App Directory Policies, Brand Guidelines, Data Usage Policy).
2. Click **Submit for Review**.
3. Check your organization email for the confirmation message.
4. Record and save the **Case ID** from the confirmation email for tracking.

### 3.5 What the review team tests
The OpenAI app review process evaluates:
1. **Connectivity**: Verifies that `https://<backend-host>/mcp` stays responsive without timeouts.
2. **OAuth handshake**: Verifies client registration, authorization redirect, consent display, and token exchange.
3. **Authentication requirement**: Reviewers log into an account to verify tool execution.
4. **Tool execution and error clarity**: Reviewers run test prompts. Every tool call must either succeed or return a clean, structured error with clear user guidance. Stack traces or bare 500 errors cause immediate rejection.
5. **Privacy and branding**: Reviewers confirm that descriptions are factual and the privacy policy is live and readable.

### 3.6 Publish the app
1. App approval does **not** list the connector automatically.
2. Once the confirmation email announces approval, return to [platform.openai.com](https://platform.openai.com) > **Apps**.
3. Locate the approved Resumer connector.
4. Click **Publish to Directory**. The app will now be visible in the public ChatGPT connector catalog.

---

## Part 4. Open items and post-launch checklist

### 4.1 Reviewer login decision
Resumer currently supports social login via Google and GitHub (`frontend/lib/auth.ts`). Reviewers require a reliable method to authenticate. Choose one of the two strategies below before submitting:

- [ ] **Option A: Provision dedicated test social accounts** (Recommended for immediate submission):
  - Create a dedicated Google test account (e.g. `openai-review@resumer.app`).
  - Add this email as a test user in Google Cloud Console OAuth consent settings.
  - Provide credentials in the private review instructions notes in the submission portal.
  - *Trade-off*: Does not require code changes in Resumer, but credentials must be maintained and monitored.
- [ ] **Option B: Add direct email / magic link login**:
  - Implement email and password or magic link authentication in NextAuth and the backend.
  - Provide a fixed test user account and password to the review team.
  - *Trade-off*: More robust for automated test runs, but requires implementing and testing an additional authentication provider.

### 4.2 Pre-submission tasks
- [ ] Generate 512x512 PNG logo asset (`resumer-icon-512.png`) with transparent-safe background.
- [ ] Verify production Railway backend domain and confirm DNS stability.
- [ ] Verify that `BACKEND_URL` in Railway environment variables is set to the HTTPS production domain.
- [ ] Verify that `NEXT_PUBLIC_MCP_URL` in Vercel environment variables points to the production `/mcp` route.
- [ ] Verify that `https://<backend-host>/system/health` and `https://<backend-host>/mcp` respond with status 200/401 as expected.
- [ ] Run test prompts 1 through 5 manually using ChatGPT Developer Mode or an MCP client.

### 4.3 Post-launch update process
- When adding, modifying, or removing MCP tools or descriptions, OpenAI requires a rescan.
- Update your server in production first.
- In [platform.openai.com](https://platform.openai.com) > **Apps**, select your connector and click **Rescan Tools**.
- Update any modified tool justifications and submit an app update for review.
- Previous published versions remain active for existing users while the update undergoes review.

### 4.4 Optional: MCP Registry publication
- After directory approval, optionally submit the Resumer MCP server to the open MCP Registry (`https://github.com/modelcontextprotocol/registry`).
- This enables auto-discovery in tools like Cursor, Claude Desktop, and Zed.
- Registry publication requires creating a pull request with an entry in `registry.json` pointing to `https://<backend-host>/mcp`.
