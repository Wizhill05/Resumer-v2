# Design: Resumer MCP Server

| Field | Value |
|-------|-------|
| **Author** | Resumer Team |
| **Date** | 2026-08-13 |
| **Status** | Draft |
| **Related** | Generation pipeline, Profile API, Editor API, Template registry |

---

## Overview

An **MCP (Model Context Protocol) server** that exposes Resumer's resume-building capabilities as structured tools to any MCP-compatible client — ChatGPT (via OAuth + GPT Actions), Claude Desktop, Cursor, etc. The server acts as a **bridge layer** between the conversational AI and the existing Resumer backend, translating natural language workflows into deterministic API calls.

The key insight: **the conversational model becomes the UI**. Instead of filling forms, users chat. Instead of navigating pages, the model calls tools. The MCP server's job is to make this safe, guided, and impossible to misuse.

---

## Background & Motivation

### Current state

Users interact with Resumer through a web frontend:
1. Sign up / sign in → profile page → manually enter contact info, projects, experiences, education, extracurriculars
2. Navigate to generate page → paste job description → pick template + content split → wait for LangGraph pipeline → download PDF
3. Optionally use the split-pane editor to tweak the generated JSON

### Problems this solves

1. **Onboarding friction**: Users abandon the profile form — too many fields, no guidance on what makes a strong bullet point.
2. **No conversational iteration**: The AI pipeline is fire-and-forget. Users can't say "make the second bullet more concise" without the editor (which operates on raw JSON).
3. **Platform lock-in**: Users must visit the web app. Power users want resume generation from ChatGPT, Claude, or their IDE.
4. **Data entry UX**: Form-based data entry is the worst way to capture career history. Conversation is natural.

---

## Architecture

### High-level

```
┌─────────────────────┐      OAuth 2.0       ┌──────────────────┐
│  ChatGPT / Claude   │ ◄──────────────────► │  Resumer MCP     │
│  (MCP Client)       │      MCP Protocol    │  Server           │
└─────────────────────┘      (SSE/stdio)     │  (Python)         │
                                              │                   │
                                              │  ┌─────────────┐  │
                                              │  │ Auth Layer   │  │
                                              │  │ (OAuth 2.0)  │  │
                                              │  └──────┬───────┘  │
                                              │         │          │
                                              │  ┌──────▼───────┐  │
                                              │  │ Tool Router   │  │
                                              │  │ + Validation  │  │
                                              │  └──────┬───────┘  │
                                              │         │          │
                                              └─────────┼──────────┘
                                                        │
                                              ┌─────────▼──────────┐
                                              │  Resumer Backend    │
                                              │  (FastAPI + DB)     │
                                              │  Same DB, same      │
                                              │  pipeline, same     │
                                              │  templates          │
                                              └─────────────────────┘
```

### Deployment options

| Option | How | Tradeoffs |
|--------|-----|-----------|
| **A. In-process (recommended v1)** | MCP server lives inside the existing FastAPI backend as a new module. Shares DB session, models, services directly. Deployed on Railway alongside the API. | Zero infra overhead. No HTTP hop. Auth reuse. Tight coupling to backend internals. |
| **B. Sidecar service** | Separate Python process. Calls backend via internal HTTP. | Independent scaling. Extra latency. Needs service auth. |
| **C. Edge worker** | Cloudflare Worker proxying to backend. | Low latency for SSE. But Workers can't run WeasyPrint / heavy Python. |

**Decision: Option A.** The MCP server is a new module `backend/src/mcp/` that imports existing models, services, and pipeline code directly. It registers as an additional transport on the FastAPI app (SSE endpoint at `/mcp`) plus supports stdio for local dev/Claude Desktop.

---

## Auth: OAuth 2.0 for Remote Clients

### Why OAuth

MCP's remote transport spec (streamable HTTP / SSE) uses OAuth 2.0 for authentication. ChatGPT's "GPT Actions" require an OAuth flow. This is the standard path.

### Flow

```
User in ChatGPT → "Generate my resume"
    │
    ▼
ChatGPT detects MCP action needs auth
    │
    ▼
Redirect to Resumer OAuth authorize endpoint
    │  GET /oauth/authorize?client_id=chatgpt&redirect_uri=...&scope=profile+generate
    ▼
User logs in via existing Resumer auth (Google/GitHub SSO)
    │
    ▼
Resumer issues authorization code → redirect back to ChatGPT
    │
    ▼
ChatGPT exchanges code for access_token + refresh_token
    │  POST /oauth/token
    ▼
ChatGPT includes Bearer token in all MCP requests
```

### Implementation

New endpoints in `backend/src/api/oauth.py`:

| Endpoint | Purpose |
|----------|---------|
| `GET /oauth/authorize` | Consent screen. Validates `client_id`, `redirect_uri`, `scope`. Shows user what the client wants. On approval, issues auth code. |
| `POST /oauth/token` | Exchanges auth code for JWT access_token (same format as existing auth) + opaque refresh_token. Also handles `grant_type=refresh_token`. |
| `POST /oauth/revoke` | Token revocation. |

New DB models:
- `OAuthClient` — registered clients (ChatGPT, Claude, etc.) with `client_id`, `client_secret_hash`, allowed `redirect_uris`, allowed `scopes`.
- `OAuthAuthorizationCode` — short-lived codes pending exchange.
- `OAuthRefreshToken` — long-lived refresh tokens with user_id + client_id + scopes.

**Scopes:**
| Scope | Grants |
|-------|--------|
| `profile:read` | Read profile, projects, experiences, education, extracurriculars |
| `profile:write` | Create/update/delete profile data |
| `generate` | Trigger resume generation, check status, download PDF |
| `generate:edit` | Edit existing generation JSON, re-render |

**Security constraints:**
- Access tokens: 1 hour expiry, JWT (reuses existing `get_current_user` infra).
- Refresh tokens: 30 day expiry, stored hashed, single-use rotation.
- Auth codes: 10 minute expiry, single-use.
- PKCE required for public clients.
- Rate limits apply per-user same as web (daily/monthly caps).

---

## MCP Tools Design

### Design philosophy

The tools are designed around a **conversational workflow**, not a CRUD API. Each tool returns structured data **plus a `_hints` object** that tells the model what to ask the user next. This is how we handle the "not enough data" edge case — the model never guesses; the tool tells it exactly what's missing.

### Tool categories

```
Profile & Data Management
├── get_profile          — Read current profile state
├── update_profile       — Set contact info, summary, skills
├── add_project          — Add one project
├── update_project       — Edit existing project
├── delete_project       — Remove a project
├── add_experience       — Add one experience
├── update_experience    — Edit existing experience
├── delete_experience    — Remove an experience
├── add_education        — Add one education entry
├── update_education     — Edit existing education
├── delete_education     — Remove an education entry
├── add_extracurricular  — Add extracurricular
├── list_data_summary    — Quick overview of all stored data with counts + gaps

Resume Generation
├── check_readiness      — Can we generate? What's missing?
├── list_templates       — Available templates with constraints
├── generate_resume      — Start generation (async)
├── get_generation_status — Poll for completion
├── get_resume_json      — Retrieve the tailored JSON result
├── download_resume      — Get presigned PDF download URL

Resume Editing (post-generation)
├── edit_resume_section  — Modify specific section of generated JSON
├── preview_resume       — Trigger HTML re-render preview
├── save_resume_edits    — Persist edits + re-export PDF/thumbnail
```

---

### Tool specifications

#### `get_profile`

Returns the user's complete profile data as structured JSON.

```json
{
  "name": "get_profile",
  "description": "Retrieve the user's complete profile including contact info, projects, experiences, education, and extracurriculars. Returns counts of each section and flags any incomplete fields.",
  "inputSchema": {},
  "output": {
    "profile": { "full_name": "...", "email": "...", ... },
    "projects": [...],
    "experiences": [...],
    "education": [...],
    "extracurriculars": [...],
    "_meta": {
      "counts": { "projects": 2, "experiences": 1, "education": 1, "extracurriculars": 0 },
      "missing_required": ["phone", "location"],
      "weak_sections": [
        { "section": "projects", "issue": "Project 'CLI Tool' has no bullet_points — add 2-3 achievement bullets" },
        { "section": "experiences", "issue": "Only 1 experience — most templates use 2-3" }
      ]
    }
  }
}
```

The `_meta` block is the key innovation. The model doesn't need custom logic to know what to ask — the tool tells it.

#### `list_data_summary`

Lightweight check without returning full data. Used for quick "what do I have?" questions.

```json
{
  "name": "list_data_summary",
  "description": "Get a concise summary of all stored profile data: counts per section, completeness percentage, and specific gaps that would hurt resume quality.",
  "inputSchema": {},
  "output": {
    "profile_complete": false,
    "completeness_pct": 62,
    "sections": {
      "contact": { "filled": 4, "total": 8, "missing": ["phone", "linkedin_url", "subtitle"] },
      "projects": { "count": 2, "with_bullets": 1, "avg_bullets": 1.5 },
      "experiences": { "count": 1, "with_bullets": 1, "avg_bullets": 2.0 },
      "education": { "count": 1 },
      "extracurriculars": { "count": 0 }
    },
    "_hints": {
      "priority_actions": [
        "Ask user for phone number and LinkedIn URL",
        "Project 'CLI Tool' needs 2-3 bullet points describing achievements",
        "Ask user about additional work experience — 1 is below typical (2-3)"
      ]
    }
  }
}
```

#### `check_readiness`

The gatekeeper tool. Called before `generate_resume`. Returns a go/no-go decision with specific blockers.

```json
{
  "name": "check_readiness",
  "description": "Check if the user's profile has enough data to generate a resume for a given template and content split. Returns blocking issues that MUST be resolved, warnings, and the recommended content split.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "template_id": { "type": "string", "description": "Template to check against. Use list_templates to see available." },
      "content_split": {
        "type": "object",
        "properties": {
          "projects": { "type": "integer" },
          "experience": { "type": "integer" }
        },
        "description": "Optional. If omitted, uses template default."
      },
      "job_description": { "type": "string", "description": "Optional. If provided, checks if profile has enough relevant content for this job." }
    }
  },
  "output": {
    "ready": false,
    "blockers": [
      {
        "type": "insufficient_data",
        "section": "projects",
        "required": 3,
        "available": 2,
        "message": "Template 'personal-classic' with project-focused split needs 3 projects but you only have 2. Add 1 more project or switch to 'Balanced' split (2 projects, 2 experiences)."
      }
    ],
    "warnings": [
      {
        "type": "weak_content",
        "section": "projects",
        "item": "CLI Tool",
        "message": "No bullet points. The AI will have limited material to tailor. Add 2-3 bullets about what you built, technologies used, and impact."
      }
    ],
    "allowed_splits": [
      { "projects": 1, "experience": 3, "label": "Experience focused", "feasible": true },
      { "projects": 2, "experience": 2, "label": "Balanced", "feasible": true },
      { "projects": 3, "experience": 1, "label": "Project focused", "feasible": false, "reason": "Need 3 projects, have 2" }
    ],
    "_hints": {
      "suggested_action": "Ask user to either add a third project or switch to Balanced split",
      "required_before_generate": ["Add 1 more project OR change content split"]
    }
  }
}
```

#### `generate_resume`

```json
{
  "name": "generate_resume",
  "description": "Start an async resume generation. Requires the user's profile to pass check_readiness. Returns a generation ID for status polling.",
  "inputSchema": {
    "type": "object",
    "required": ["job_description", "template_id"],
    "properties": {
      "job_description": { "type": "string", "description": "Full job description text." },
      "template_id": { "type": "string" },
      "content_split": {
        "type": "object",
        "properties": {
          "projects": { "type": "integer" },
          "experience": { "type": "integer" }
        }
      },
      "keywords": { "type": "array", "items": { "type": "string" }, "description": "Optional extra keywords to emphasize." },
      "instructions": { "type": "string", "description": "Optional custom instructions for the AI (e.g. 'emphasize leadership')." }
    }
  }
}
```

#### `get_generation_status`

```json
{
  "name": "get_generation_status",
  "description": "Check the status of an in-progress or completed generation. Returns status, progress logs, and download URL when complete.",
  "inputSchema": {
    "type": "object",
    "required": ["generation_id"],
    "properties": {
      "generation_id": { "type": "string" }
    }
  },
  "output_when_complete": {
    "status": "completed",
    "job_title": "Backend Engineer",
    "company": "Acme Corp",
    "download_url": "https://...",
    "resume_summary": {
      "tailored_for": "Backend Engineer at Acme Corp",
      "sections": ["summary", "skills (3 categories)", "2 experiences", "2 projects", "1 education"],
      "page_count": 1,
      "font_size": 10.5
    },
    "_hints": {
      "next_actions": [
        "User can download the PDF via the download_url",
        "User can ask to see or edit specific sections using get_resume_json / edit_resume_section",
        "User can generate another version with different settings"
      ]
    }
  }
}
```

#### `get_resume_json`

```json
{
  "name": "get_resume_json",
  "description": "Retrieve the full tailored resume JSON for a completed generation. Use this to show the user what was generated or to prepare edits.",
  "inputSchema": {
    "type": "object",
    "required": ["generation_id"],
    "properties": {
      "generation_id": { "type": "string" },
      "section": {
        "type": "string",
        "enum": ["summary", "skills", "projects", "experiences", "education", "all"],
        "description": "Return only a specific section. Defaults to 'all'."
      }
    }
  }
}
```

#### `edit_resume_section`

```json
{
  "name": "edit_resume_section",
  "description": "Edit a specific part of a completed resume's tailored JSON. Supports surgical updates to individual fields, bullets, or entire sections. Returns the updated section and a preview status.",
  "inputSchema": {
    "type": "object",
    "required": ["generation_id", "edits"],
    "properties": {
      "generation_id": { "type": "string" },
      "edits": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["path", "value"],
          "properties": {
            "path": {
              "type": "string",
              "description": "JSON path to the field. Examples: 'summary', 'skills.Languages', 'projects[0].bullet_points[1]', 'experiences[1].role'"
            },
            "value": {
              "description": "New value for the field. Type must match the schema (string for text, array for bullets, etc.)"
            },
            "operation": {
              "type": "string",
              "enum": ["set", "append", "remove"],
              "default": "set",
              "description": "'set' replaces, 'append' adds to array, 'remove' deletes from array by index"
            }
          }
        }
      }
    }
  },
  "output": {
    "updated_section": { "...": "the changed section after edit" },
    "page_count": 1,
    "fit_warning": false,
    "_hints": {
      "review_suggestion": "The second project now has 4 bullets which may cause overflow. Consider trimming to 3."
    }
  }
}
```

#### Data entry tools (`add_project`, `add_experience`, etc.)

All follow the same pattern. Example for `add_project`:

```json
{
  "name": "add_project",
  "description": "Add a new project to the user's profile. Returns the created project and hints about what else is needed.",
  "inputSchema": {
    "type": "object",
    "required": ["name"],
    "properties": {
      "name": { "type": "string" },
      "description": { "type": "string" },
      "technologies": { "type": "array", "items": { "type": "string" } },
      "bullet_points": { "type": "array", "items": { "type": "string" } },
      "github_url": { "type": "string" },
      "live_url": { "type": "string" },
      "start_date": { "type": "string", "description": "ISO date or 'Jan 2025' format" },
      "end_date": { "type": "string" }
    }
  },
  "output": {
    "project": { "id": "...", "name": "...", "..." : "..." },
    "_meta": {
      "total_projects": 3,
      "quality_notes": [
        "Missing bullet_points — AI will have limited material to tailor this project"
      ]
    },
    "_hints": {
      "follow_up": "Ask the user for 2-3 bullet points about what they built, what technologies they used, and what impact it had"
    }
  }
}
```

---

## Edge Case Handling: The `_hints` System

The core UX problem: **the model (ChatGPT/Claude) needs to know when to ask for more data and what to ask.** We solve this server-side, not by hoping the model figures it out.

### How it works

Every tool response includes a `_hints` object with structured guidance:

```python
class ToolHints(BaseModel):
    """Guidance for the AI model on what to do next."""
    priority_actions: list[str] = []      # Things the user should do NOW
    follow_up: str | None = None          # Suggested next question to ask user
    next_actions: list[str] = []          # Available next steps
    suggested_action: str | None = None   # Single recommended action
    required_before_generate: list[str] = []  # Blockers before generation
    review_suggestion: str | None = None  # Post-edit quality note
```

### Edge case matrix

| Scenario | Tool | Behavior |
|----------|------|----------|
| **New user, no data** | `get_profile` | Returns empty profile + `_hints.priority_actions = ["Ask user for full name, email, phone, location", "Ask about work experience", "Ask about projects"]` |
| **Resume wants 3 projects, user has 2** | `check_readiness` | `ready=false`, blocker explains the gap, `_hints.suggested_action = "Ask user to add a project or switch to Balanced split"` |
| **Project has no bullets** | `add_project` or `check_readiness` | Warning: `"Project 'X' has no bullet_points"`, hint: `"Ask user for 2-3 achievement bullets"` |
| **No experience at all** | `check_readiness` | Blocker if split requires experience. Suggests project-focused split as alternative. |
| **Generation failed** | `get_generation_status` | `status="failed"`, `error_message="..."`, `_hints.next_actions = ["Try again", "Check profile completeness"]` |
| **Edit causes overflow** | `edit_resume_section` | `fit_warning=true`, `_hints.review_suggestion = "Content exceeds 1 page at minimum font size. Consider removing a bullet."` |
| **User asks to edit non-existent generation** | `edit_resume_section` | HTTP 404 → MCP error with `"No generation found with that ID. Use get_generation_status to list recent generations."` |
| **Rate limit hit** | `generate_resume` | HTTP 429 → MCP error with `"Daily generation limit reached (5/day). Resets in 14h."` |
| **Missing required field in tool call** | Any write tool | MCP validation error before hitting backend. |

### First-time user conversation flow

```
User: "I want to build my resume"
Model: calls get_profile()
Server: returns empty profile + hints

Model: "I'd be happy to help! I don't have any of your information yet.
        Let's start with the basics. What's your full name?"
User: "Aryan Singh"
Model: "Great! What's your email, phone number, and location?"
User: "aryan@email.com, +1-555-0123, San Francisco, CA"
Model: calls update_profile(full_name="Aryan Singh", email="aryan@email.com",
                            phone="+1-555-0123", location="San Francisco, CA")
Server: returns updated profile + hints["Ask about LinkedIn, GitHub, portfolio URLs"]

Model: "Do you have a LinkedIn profile, GitHub, or portfolio website?"
User: "linkedin.com/in/aryan, github.com/aryan"
Model: calls update_profile(linkedin_url="...", github_url="...")

Model: "Now let's add your work experience. Tell me about your
        most recent role — job title, company, dates, and what you did."
...continues guided by _hints...
```

---

## Detailed Data Flow: Generation via MCP

```
1. User: "Generate a resume for this Backend Engineer role at Acme Corp"
   └── Model pastes/provides job description

2. Model: calls check_readiness(template_id="personal-classic",
                                 job_description="...",
                                 content_split={"projects": 2, "experience": 2})
   └── Server validates:
       ✓ Profile exists with required fields
       ✓ ≥2 projects (has 3, OK)
       ✓ ≥2 experiences (has 2, OK)
       ✓ Education present
       ⚠ Project "CLI Tool" has weak bullets
   └── Returns: ready=true, warnings=[weak content note]

3. Model: "Your profile looks good! One note: your 'CLI Tool' project
           has limited bullet points. Want to add more detail before
           we generate, or proceed as-is?"
   User: "Proceed"

4. Model: calls generate_resume(
       job_description="...",
       template_id="personal-classic",
       content_split={"projects": 2, "experience": 2}
   )
   └── Server:
       a. Validates rate limit (same as web)
       b. Creates Generation row (status="pending")
       c. Kicks off pipeline via trigger_pipeline() (same LangGraph)
       d. Returns generation_id immediately

5. Model: "Generating your resume... this takes about 30 seconds."
   Model: calls get_generation_status(generation_id="abc-123")
   └── Server: status="processing", logs=["Job analysis complete", "Tailoring experience..."]
   Model: "Still working on it — the AI is tailoring your experience section now."

6. Model: calls get_generation_status(generation_id="abc-123")
   └── Server: status="completed", download_url="https://...",
       resume_summary={...}, _hints={next_actions=[...]}

7. Model: "Your resume is ready! Here's what was generated:
           - Tailored for: Backend Engineer at Acme Corp
           - 2 experiences, 2 projects, 1 education
           - Fits on 1 page at 10.5pt font

           [Download PDF](https://...)

           Want me to show you any section or make edits?"
```

---

## Module Structure

```
backend/src/mcp/
├── __init__.py
├── server.py           # MCP server setup, tool registration, SSE + stdio transports
├── auth.py             # OAuth 2.0 middleware: token validation, scope checking
├── tools/
│   ├── __init__.py
│   ├── profile.py      # get_profile, update_profile, list_data_summary
│   ├── projects.py     # add/update/delete_project
│   ├── experiences.py  # add/update/delete_experience
│   ├── education.py    # add/update/delete_education
│   ├── extras.py       # add/update/delete_extracurricular
│   ├── generation.py   # check_readiness, generate_resume, get_status, download
│   └── editor.py       # get_resume_json, edit_resume_section, save_resume_edits
├── hints.py            # _hints computation logic (gap analysis, quality checks)
└── schemas.py          # Pydantic models for tool inputs/outputs

backend/src/api/oauth.py        # OAuth 2.0 endpoints (authorize, token, revoke)
backend/src/models/oauth.py     # OAuthClient, OAuthAuthorizationCode, OAuthRefreshToken
```

### Dependencies

Add to `pyproject.toml`:
```toml
"mcp>=1.0",           # Official MCP Python SDK (Anthropic)
```

The MCP Python SDK handles protocol serialization, SSE transport, stdio transport, and tool schema registration. We only write tool handlers.

---

## API Surface Changes

### New FastAPI routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/oauth/authorize` | `GET` | OAuth authorization endpoint |
| `/oauth/token` | `POST` | Token exchange |
| `/oauth/revoke` | `POST` | Token revocation |
| `/mcp` | `GET/POST` | MCP SSE transport (streamable HTTP) |

### No changes to existing routes

The MCP tools call existing service-layer functions directly (DB queries, pipeline trigger, storage). No new REST endpoints needed for tool functionality.

---

## DB Schema Changes

### New tables

```sql
-- OAuth registered clients
CREATE TABLE oauth_clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id VARCHAR UNIQUE NOT NULL,          -- e.g. "chatgpt", "claude-desktop"
    client_secret_hash VARCHAR,                  -- NULL for public clients (PKCE)
    name VARCHAR NOT NULL,                       -- Display name
    redirect_uris TEXT[] NOT NULL,
    allowed_scopes TEXT[] NOT NULL,
    is_public BOOLEAN DEFAULT false,             -- Public clients use PKCE, no secret
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Short-lived authorization codes
CREATE TABLE oauth_authorization_codes (
    code VARCHAR PRIMARY KEY,
    client_id VARCHAR NOT NULL REFERENCES oauth_clients(client_id),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redirect_uri VARCHAR NOT NULL,
    scopes TEXT[] NOT NULL,
    code_challenge VARCHAR,                      -- PKCE
    code_challenge_method VARCHAR DEFAULT 'S256',
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Refresh tokens
CREATE TABLE oauth_refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash VARCHAR UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id VARCHAR NOT NULL REFERENCES oauth_clients(client_id),
    scopes TEXT[] NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

### No changes to existing tables

Profile, Generation, User tables stay identical. The MCP server reads/writes them through the same SQLAlchemy models.

---

## Implementation Plan

### Phase 1: Foundation (OAuth + MCP skeleton)

| # | Task | Details |
|---|------|---------|
| 1.1 | Add `mcp` dependency | `pyproject.toml` |
| 1.2 | Create OAuth DB models | `models/oauth.py` + Alembic migration |
| 1.3 | Implement OAuth endpoints | `api/oauth.py` — authorize, token, revoke |
| 1.4 | Create MCP server skeleton | `mcp/server.py` — SSE transport, stdio transport, auth middleware |
| 1.5 | Register MCP endpoint on FastAPI | Mount at `/mcp` |
| 1.6 | Implement 1 test tool | `get_profile` — end-to-end proof of concept |
| 1.7 | Test with MCP Inspector | Verify tool discovery, auth flow, tool execution |

### Phase 2: Profile & Data Tools

| # | Task | Details |
|---|------|---------|
| 2.1 | `list_data_summary` | Gap analysis + hints |
| 2.2 | `update_profile` | Contact info, summary, skills |
| 2.3 | `add/update/delete_project` | Full CRUD with quality hints |
| 2.4 | `add/update/delete_experience` | Full CRUD with quality hints |
| 2.5 | `add/update/delete_education` | Full CRUD with quality hints |
| 2.6 | `add/update/delete_extracurricular` | Full CRUD with quality hints |
| 2.7 | `hints.py` core logic | Centralized gap analysis, quality scoring |

### Phase 3: Generation Tools

| # | Task | Details |
|---|------|---------|
| 3.1 | `list_templates` | Return template manifests with allowed splits |
| 3.2 | `check_readiness` | Validate profile against template + split + optional JD |
| 3.3 | `generate_resume` | Reuse existing `trigger_pipeline`, respect rate limits |
| 3.4 | `get_generation_status` | Poll status + logs + download URL when complete |
| 3.5 | `download_resume` | Return presigned R2 URL |

### Phase 4: Editor Tools

| # | Task | Details |
|---|------|---------|
| 4.1 | `get_resume_json` | Retrieve `render_metadata.tailored_resume` |
| 4.2 | `edit_resume_section` | JSON-path based surgical edits |
| 4.3 | `preview_resume` | Trigger re-render, return page count + fit status |
| 4.4 | `save_resume_edits` | Persist to DB + re-export PDF/thumb to R2 |

### Phase 5: ChatGPT Integration

| # | Task | Details |
|---|------|---------|
| 5.1 | Register OAuth client for ChatGPT | Seed `oauth_clients` row |
| 5.2 | Create OpenAPI/GPT Actions manifest | Expose MCP tools as GPT Actions for ChatGPT (if needed alongside MCP) |
| 5.3 | Test full flow in ChatGPT | Auth → profile setup → generation → download → edit |
| 5.4 | Write system prompt guidance | Instructions for ChatGPT on how to use the tools conversationally |

### Phase 6: Polish & Hardening

| # | Task | Details |
|---|------|---------|
| 6.1 | Rate limiting per OAuth client | Prevent one client from exhausting user's quota |
| 6.2 | Audit logging | Track which client performed which action |
| 6.3 | Token rotation hardening | Detect refresh token reuse (token theft) |
| 6.4 | Error mapping | Map all backend exceptions to clean MCP error responses |
| 6.5 | Claude Desktop / Cursor testing | Verify stdio transport works |

---

## MCP Server Configuration

### For ChatGPT (remote, SSE)

ChatGPT connects via the hosted SSE endpoint:
```
URL: https://api.resumer.app/mcp
Auth: OAuth 2.0 (configured in ChatGPT GPT Actions)
```

### For Claude Desktop (local, stdio)

```json
{
  "mcpServers": {
    "resumer": {
      "command": "uv",
      "args": ["run", "--directory", "/path/to/backend", "python", "-m", "src.mcp.server", "--transport", "stdio"],
      "env": {
        "DATABASE_URL": "postgresql+psycopg://...",
        "RESUMER_MCP_USER_EMAIL": "user@example.com"
      }
    }
  }
}
```

For local stdio transport, auth is simplified: the user provides their email in env vars, and the server auto-authenticates (no OAuth dance needed for local use).

---

## Key Design Decisions

### 1. In-process vs. separate service
**Decision:** In-process. The MCP server imports `src.models`, `src.core.database`, `src.pipeline` directly. No HTTP hop, no service auth, no data duplication.

### 2. Tools as thin wrappers vs. new business logic
**Decision:** Thin wrappers. Each tool calls the same DB queries and pipeline functions the REST API uses. The only new logic is `hints.py` (gap analysis) and `schemas.py` (MCP-specific I/O shapes).

### 3. Sync generation vs. async with polling
**Decision:** Async with polling, same as web. `generate_resume` returns immediately with a `generation_id`. The model polls `get_generation_status`. This avoids MCP request timeouts (generations take 20-60s).

### 4. JSON-path editing vs. full-replace
**Decision:** JSON-path edits in `edit_resume_section`. The model says `"path": "projects[0].bullet_points[1]", "value": "Built a REST API..."` instead of sending the entire resume JSON. Reduces tokens, reduces error surface.

### 5. `_hints` system vs. relying on model intelligence
**Decision:** Server-driven hints. The model is not trusted to figure out "you need 3 projects but have 2" — the tool computes this deterministically and returns structured guidance. This works across all models (GPT-4o, Claude, Gemini) without model-specific prompt engineering.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| ChatGPT MCP support is early/unstable | Integration may break | Also expose tools as GPT Actions (OpenAPI) as fallback |
| OAuth adds attack surface | Token theft, CSRF | PKCE, short-lived tokens, refresh rotation, CSRF state param |
| Model ignores `_hints` and asks bad questions | Poor UX | Provide a system prompt with explicit instructions; hints are structured enough that any model should follow |
| Generation timeout via MCP | Long-running tool call fails | Async polling pattern avoids this entirely |
| MCP SDK breaking changes | Build breaks | Pin SDK version; MCP spec is stabilizing |
| Scope creep into "AI agent" territory | Unbounded model actions | Tools are idempotent reads + user-scoped writes. No tool can affect other users. Rate limits apply. |

---

## Open Questions

1. **MCP vs. GPT Actions**: ChatGPT may not fully support MCP over SSE yet. We may need to expose the same tools as an OpenAPI spec for GPT Actions as a bridge. The tool implementations stay the same — only the transport/registration layer changes.

2. **Resume import via MCP**: Should we expose the resume import (PDF/LinkedIn parsing) as an MCP tool? Deferred to post-v1 — the existing import flow is complex and has its own edge cases.

3. **Notification on completion**: In the web app, users get an email when generation completes. For MCP, the model is polling. Should we also support MCP notifications/resources for push updates? Deferred — polling is simpler and works.

4. **Multi-generation comparison**: Users might want "generate 3 versions and compare." Not in v1 scope — each generation is independent. The model can orchestrate this by calling `generate_resume` multiple times.
