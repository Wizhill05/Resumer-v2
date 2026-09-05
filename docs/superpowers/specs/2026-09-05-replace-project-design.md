# Replace Project in Resume Editor with Whole-Resume Re-tailor & Orphan Repair

## Overview
Allows users in the resume editor (both desktop and mobile) to replace an existing project in their resume with a different project saved in their profile database. The backend re-tailors the resume using an LLM to integrate the new project in context, followed by an automated WeasyPrint orphan detection and repair pass. The action is free and unlimited.

## Requirements
1. **Frontend (Desktop & Mobile)**:
   - In `ResumeFormEditor`, each project card displays a "Replace from Profile" button.
   - Clicking opens a modal/sheet listing saved user projects from `/api/backend/profile/projects`.
   - Projects currently present in the active resume are disabled and badged as "Active".
   - Shows project title and technologies.
   - Empty state when no unused projects exist: "No other projects found in your profile. Add projects in your Profile first."
   - Confirming substitution triggers `POST /api/backend/generate/{gen_id}/replace-project` with `target_project_index`, `new_profile_project_id`, and in-memory `current_resume`.
   - Displays loading indicator during replacement and disables form inputs.
   - On success, updates form state (`parsedResume`, `rawJson`) and refreshes live preview.
2. **Backend API Endpoint**:
   - `POST /generate/{gen_id}/replace-project`
   - Validates ownership of `gen_id` and `new_profile_project_id`.
   - Validates `target_project_index` is within range of `current_resume.projects`.
   - Unlimited/free: No credit check or deduction.
   - Re-tailors the resume: formats the replacement project, runs whole-resume tailoring LLM prompt.
   - Runs WeasyPrint orphan detection (`detect_orphans_in_weasyprint`).
   - If orphans detected: runs `orphan_repair_node` (max 2 passes).
   - Returns updated tailored resume JSON and orphan stats.
