# Replace Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement "Replace Project from Profile" feature in Resume Editor for desktop and mobile, with backend LLM whole-resume re-tailoring and WeasyPrint orphan detection/repair pass. Free and unlimited.

**Architecture:** A new backend endpoint `POST /generate/{id}/replace-project` receives the active in-memory resume, target project index, and selected profile project ID. It loads the target job analysis and user's profile project, prompts the LLM to integrate the replacement project and re-tailor the resume structure, compiles WeasyPrint layout to detect orphan lines, runs orphan repair if necessary, and returns the updated resume JSON. The frontend provides a responsive dialog to select an unused project from the user's profile, triggers the endpoint, displays loading progress, and updates editor state and preview.

**Tech Stack:** FastAPI, Pydantic v2, SQLAlchemy/SQLModel (async), LangChain / OpenAI / OpenRouter, WeasyPrint, Next.js 16 (App Router), React 19, Tailwind CSS v4, Lucide icons.

**Spec:** `docs/superpowers/specs/2026-09-05-replace-project-design.md`

## Global Constraints
- Do NOT start `pnpm dev` or `next dev` inside the agent session.
- Edits in the editor are free and unlimited; do not check or deduct generation credits for replacement.
- Maintain Next.js 16 and Tailwind CSS v4 styling idioms matching existing editor components.
- Always validate that both the generation and the profile project belong to the authenticated user.

---

### Task 1: Backend Schemas & LLM Re-tailor Logic

**Files:**
- Modify: `backend/src/schemas/generation.py`
- Create: `backend/src/services/resume_retailor.py`
- Test: `backend/tests/test_replace_project.py`

**Interfaces:**
- Consumes: `TailoredResume`, `UserProject`, `Generation`, `detect_resume_orphans`, `orphan_repair_node`
- Produces: `ReplaceProjectRequest`, `ReplaceProjectResponse`, `retailor_resume_with_project(...)`

- [ ] **Step 1: Write failing unit test for replace project schemas and validation**

Create `backend/tests/test_replace_project.py`:
```python
import pytest
from uuid import uuid4
from src.schemas.generation import ReplaceProjectRequest, ReplaceProjectResponse

def test_replace_project_request_schema():
    req = ReplaceProjectRequest(
        target_project_index=1,
        profile_project_id=uuid4(),
        current_resume={
            "summary": "Experienced engineer",
            "skills": {"Languages": ["Python", "TypeScript"]},
            "experiences": [],
            "projects": [{"name": "Old Project", "bullet_points": ["Did X"]}],
            "education": [],
            "extracurriculars": [],
        },
    )
    assert req.target_project_index == 1
    assert req.current_resume["summary"] == "Experienced engineer"

def test_replace_project_response_schema():
    res = ReplaceProjectResponse(
        success=True,
        tailored_resume={"projects": []},
        orphans_detected=0,
        orphans_repaired=0,
    )
    assert res.success is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `/home/azureuser/resumer/backend/.venv/bin/pytest tests/test_replace_project.py`
Expected: FAIL with `ImportError: cannot import name 'ReplaceProjectRequest'`

- [ ] **Step 3: Implement schemas in `backend/src/schemas/generation.py`**

Add `ReplaceProjectRequest` and `ReplaceProjectResponse` to `backend/src/schemas/generation.py`:
```python
class ReplaceProjectRequest(BaseModel):
    """Body for POST /generate/{id}/replace-project."""
    target_project_index: int
    profile_project_id: uuid.UUID
    current_resume: dict[str, Any]
    profile: dict[str, Any] | None = None

class ReplaceProjectResponse(BaseModel):
    """Response for POST /generate/{id}/replace-project."""
    success: bool
    tailored_resume: dict[str, Any]
    orphans_detected: int = 0
    orphans_repaired: int = 0
    font_size: float | None = None
    page_count: int | None = None
    fit_warning: bool = False
```

- [ ] **Step 4: Run test to verify schemas pass**

Run: `/home/azureuser/resumer/backend/.venv/bin/pytest tests/test_replace_project.py`
Expected: PASS

- [ ] **Step 5: Implement `retailor_resume_with_project` in `backend/src/services/resume_retailor.py`**

Implement `retailor_resume_with_project`:
- Takes `db`, `gen`, `target_index`, `new_project_data`, `current_resume`, `profile_data`.
- Builds LLM prompt with target job context + raw candidate project info + existing resume structure.
- Calls LLM structured output to produce updated tailored resume JSON.
- Runs `detect_resume_orphans`.
- If orphans detected and repair possible, runs orphan repair loop to fine-tune bullets.
- Returns `(updated_resume, orphans_detected_count, orphans_repaired_count)`.

- [ ] **Step 6: Write unit test with mock LLM for `retailor_resume_with_project`**

Add to `backend/tests/test_replace_project.py`:
Test that invalid `target_project_index` (< 0 or >= len(projects)) raises ValueError or appropriate validation error.

- [ ] **Step 7: Run test to verify it passes**

Run: `/home/azureuser/resumer/backend/.venv/bin/pytest tests/test_replace_project.py`
Expected: PASS

- [ ] **Step 8: Commit Task 1**

```bash
git add backend/src/schemas/generation.py backend/src/services/resume_retailor.py backend/tests/test_replace_project.py
git commit -m "feat(backend): add replace-project schemas and re-tailor service"
```

---

### Task 2: Backend API Endpoint `POST /generate/{id}/replace-project`

**Files:**
- Modify: `backend/src/api/generation.py`
- Test: `backend/tests/test_replace_project_api.py`

**Interfaces:**
- Consumes: `ReplaceProjectRequest`, `_get_completed_gen_for_editor`, `retailor_resume_with_project`
- Produces: Route `POST /generate/{id}/replace-project` -> `ReplaceProjectResponse`

- [ ] **Step 1: Write API test for endpoint authorization & validation**

Create `backend/tests/test_replace_project_api.py`:
- Test unauthorized access returns 401.
- Test replacing with project ID belonging to another user returns 404/403.
- Test out-of-bounds `target_project_index` returns 400.

- [ ] **Step 2: Run test to verify it fails**

Run: `/home/azureuser/resumer/backend/.venv/bin/pytest tests/test_replace_project_api.py`
Expected: FAIL (route not found)

- [ ] **Step 3: Implement endpoint in `backend/src/api/generation.py`**

Add `@router.post("/{gen_id}/replace-project", response_model=ReplaceProjectResponse)`:
- Authenticates `current_user`.
- Calls `_get_completed_gen_for_editor(gen_id, current_user, db)`.
- Fetches `UserProject` by `data.profile_project_id` and verifies `user_id == current_user.id`.
- Validates `0 <= data.target_project_index < len(data.current_resume.get("projects", []))`.
- Invokes `retailor_resume_with_project`.
- Updates `gen.render_metadata["tailored_resume"] = updated_resume` and increments `editor_revision`.
- Saves to DB.
- Returns `ReplaceProjectResponse`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `/home/azureuser/resumer/backend/.venv/bin/pytest tests/test_replace_project_api.py`
Expected: PASS

- [ ] **Step 5: Run existing backend tests to ensure no regressions**

Run: `/home/azureuser/resumer/backend/.venv/bin/pytest tests/`
Expected: All tests PASS

- [ ] **Step 6: Commit Task 2**

```bash
git add backend/src/api/generation.py backend/tests/test_replace_project_api.py
git commit -m "feat(backend): add POST /generate/{id}/replace-project endpoint"
```

---

### Task 3: Frontend Project Replacement Dialog & Button

**Files:**
- Create: `frontend/components/editor/ReplaceProjectModal.tsx`
- Modify: `frontend/components/editor/ResumeFormEditor.tsx`
- Modify: `frontend/app/dashboard/history/[id]/edit/EditorClient.tsx`
- Modify: `frontend/lib/resume-schema.ts`

**Interfaces:**
- Consumes: `GET /api/backend/profile/projects`, `POST /api/backend/generate/{id}/replace-project`
- Produces: `ReplaceProjectModal`, "Replace from Profile" button on each project in `ResumeFormEditor`

- [ ] **Step 1: Add frontend schema types in `frontend/lib/resume-schema.ts`**

Add `ReplaceProjectResponse` type to `frontend/lib/resume-schema.ts`:
```typescript
export type ReplaceProjectResponse = {
  success: boolean
  tailored_resume: TailoredResume
  orphans_detected: number
  orphans_repaired: number
  font_size?: number | null
  page_count?: number | null
  fit_warning?: boolean
}
```

- [ ] **Step 2: Create `frontend/components/editor/ReplaceProjectModal.tsx`**

Create modal component:
- Props:
  - `isOpen: boolean`
  - `onClose: () => void`
  - `targetProjectName: string`
  - `activeProjectNames: string[]`
  - `onSelectProject: (projectId: string) => Promise<void>`
  - `isLoading: boolean`
- Fetches `/api/backend/profile/projects` using `fetch` or React query.
- Identifies projects whose names match active projects in `activeProjectNames` and badges them as "Currently in resume" (disabled).
- Shows empty state if 0 available replacement projects.
- Clean responsive layout for both mobile and desktop screens (centered dialog on desktop, bottom sheet style or responsive modal on mobile).
- Action buttons: "Cancel" and "Replace with AI" (with spinner while `isLoading`).

- [ ] **Step 3: Integrate button and modal in `frontend/components/editor/ResumeFormEditor.tsx`**

In `ResumeFormEditor.tsx`:
- Add `genId?: string` and `onReplaceProject?: (targetIndex: number, profileProjectId: string) => Promise<void>` to props.
- Add "Replace from Profile" small button inside each project card header or footer:
  - Styling: subtle, small slab button with `ArrowLeftRight` icon.
  - Accessible on touch and desktop.
- Manage modal state (`replacingIndex: number | null`).
- Connect `onSelectProject` to pass `(replacingIndex, selectedProjectId)`.

- [ ] **Step 4: Connect replacement flow in `frontend/app/dashboard/history/[id]/edit/EditorClient.tsx`**

In `EditorClient.tsx`:
- Implement `handleReplaceProject(targetIndex: number, profileProjectId: string)`:
  - Sets `isReplacing(true)` loading state with a top banner / toast: "Re-tailoring resume with replaced project..."
  - Calls `POST /api/backend/generate/${payload.id}/replace-project` sending `target_project_index`, `profile_project_id`, `current_resume: parsedResume`, `profile`.
  - On response:
    - Updates `parsedResume`, `rawJson`, `revision`.
    - Updates `fitFontPt`, `fitPageCount`, `fitWarning` if returned.
    - Sets `dirty(false)`.
    - Notifies user: "Project replaced and resume re-tailored successfully!" (including mention of orphan repair if repaired > 0).
  - Handles errors with clear alert/banner message.

- [ ] **Step 5: Verify build & typecheck**

Run: `cd frontend && pnpm run build` or `pnpm exec tsc --noEmit`
Expected: 0 TypeScript errors.

- [ ] **Step 6: Commit Task 3**

```bash
git add frontend/
git commit -m "feat(frontend): add replace project modal and editor integration"
```

---

### Task 4: End-to-End Verification

**Files:**
- Review: all modified files
- Verification commands:
  - Backend tests: `pytest`
  - Frontend typecheck: `pnpm exec tsc --noEmit`
  - Backend lint/ruff check

- [ ] **Step 1: Run full backend test suite**
Run: `/home/azureuser/resumer/backend/.venv/bin/pytest`
Expected: All tests pass.

- [ ] **Step 2: Run frontend typecheck**
Run: `pnpm --prefix frontend exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit all remaining changes and verify git status**
Ensure worktree is clean and all commits are formatted properly.
