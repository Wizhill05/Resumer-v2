from __future__ import annotations

import json
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.mcp.context import get_current_mcp_user, get_mcp_db
from src.models.profile import (
    Profile,
    UserEducation,
    UserExperience,
    UserExtracurricular,
    UserProject,
)
from src.template_registry.service import TemplateRegistryService


async def list_templates_handler() -> dict[str, Any]:
    """List available resume templates with their layout manifests, content splits, and constraints."""
    templates = TemplateRegistryService.list_templates()
    return {
        "templates": [
            {
                "id": t.id,
                "name": t.name,
                "description": t.description,
                "target_pages": t.target_pages,
                "content_slots": t.content_slots,
                "default_content_split": t.default_content_split.model_dump(),
                "allowed_content_splits": [s.model_dump() for s in t.allowed_content_splits],
                "has_summary": t.has_summary,
                "has_education": t.has_education,
                "has_extracurricular": t.has_extracurricular,
            }
            for t in templates
        ]
    }


async def check_readiness_handler(
    template_id: str = "personal-classic",
    content_split: dict[str, int] | None = None,
    job_description: str | None = None,
) -> dict[str, Any]:
    """Check if the user's profile has enough data to generate a high-quality resume for a given template."""
    user = get_current_mcp_user()
    template = TemplateRegistryService.get_template_manifest(template_id)
    if not template:
        return {
            "is_ready": False,
            "status": "BLOCKED",
            "score": 0,
            "blocking_reasons": [f"Template '{template_id}' not found."],
            "gaps": [],
            "ai_steering": {
                "recommended_action": "PROMPT_USER_FOR_VALID_TEMPLATE",
                "system_directive": f"Template '{template_id}' is invalid. Call list_templates to choose a valid template.",
                "suggested_questions": ["Which template would you like to use? (e.g. personal-classic)"],
            },
        }

    # Resolve required split
    req_projects = template.default_content_split.projects
    req_experience = template.default_content_split.experience
    if content_split:
        req_projects = content_split.get("projects", req_projects)
        req_experience = content_split.get("experience", req_experience)

    async with get_mcp_db() as db:
        # Load user data
        res_prof = await db.execute(select(Profile).where(Profile.user_id == user.id))
        profile = res_prof.scalar_one_or_none()

        res_proj = await db.execute(select(UserProject).where(UserProject.user_id == user.id))
        projects = res_proj.scalars().all()

        res_exp = await db.execute(select(UserExperience).where(UserExperience.user_id == user.id))
        experiences = res_exp.scalars().all()

        res_edu = await db.execute(select(UserEducation).where(UserEducation.user_id == user.id))
        education = res_edu.scalars().all()

        res_extra = await db.execute(select(UserExtracurricular).where(UserExtracurricular.user_id == user.id))
        extracurriculars = res_extra.scalars().all()

    blocking_reasons: list[str] = []
    gaps: list[dict[str, Any]] = []
    suggested_questions: list[str] = []

    # 1. Check Identity
    full_name = (profile.full_name if profile else None) or user.name
    contact_email = (profile.email if profile else None) or user.email

    if not full_name:
        blocking_reasons.append("Missing candidate's full name in profile.")
        gaps.append({
            "category": "identity",
            "field": "full_name",
            "severity": "BLOCKING",
            "message": "Full name is missing.",
            "suggested_fix": "Ask user for their full name.",
        })
        suggested_questions.append("What is your full name to display on the resume?")

    if not contact_email:
        blocking_reasons.append("Missing candidate contact email.")
        gaps.append({
            "category": "identity",
            "field": "email",
            "severity": "BLOCKING",
            "message": "Contact email is missing.",
            "suggested_fix": "Ask user for their contact email address.",
        })
        suggested_questions.append("What email address should recruiters reach you at?")

    # 2. Check Projects Requirement
    if len(projects) < req_projects:
        diff = req_projects - len(projects)
        blocking_reasons.append(
            f"Template '{template_id}' with split ({req_projects} projects, {req_experience} experiences) requires at least {req_projects} project(s), but only {len(projects)} found."
        )
        gaps.append({
            "category": "projects",
            "field": "projects",
            "severity": "BLOCKING",
            "message": f"Missing {diff} project entry/entries.",
            "suggested_fix": f"Ask user to provide details for {diff} more project(s).",
        })
        if len(projects) == 0:
            suggested_questions.append(
                f"Your target resume template needs {req_projects} projects. Could you tell me about projects you've built (names, technologies used, and what they did)?"
            )
        else:
            suggested_questions.append(
                f"You currently have {len(projects)} project ('{projects[0].name}'). We need {req_projects} for this template. Could you share details about another project you've worked on?"
            )

    # 3. Check Experience Requirement
    if len(experiences) < req_experience:
        diff = req_experience - len(experiences)
        blocking_reasons.append(
            f"Template '{template_id}' with split ({req_projects} projects, {req_experience} experiences) requires at least {req_experience} experience(s), but only {len(experiences)} found."
        )
        gaps.append({
            "category": "experiences",
            "field": "experiences",
            "severity": "BLOCKING",
            "message": f"Missing {diff} work experience entry/entries.",
            "suggested_fix": f"Ask user to provide details for {diff} more work experience(s).",
        })
        suggested_questions.append(
            f"We need {req_experience} work experience entry/entries for this resume layout. Could you share your job title, company name, and key responsibilities?"
        )

    # 4. Check Project Quality Warnings
    for i, p in enumerate(projects):
        if not p.technologies or len(p.technologies) == 0:
            gaps.append({
                "category": "project_quality",
                "field": f"projects[{i}].technologies",
                "severity": "WARNING",
                "message": f"Project '{p.name}' does not list technologies or frameworks used.",
                "suggested_fix": f"Ask user what tech stack was used for '{p.name}'.",
            })
            suggested_questions.append(f"What programming languages, frameworks, or databases did you use for '{p.name}'?")

    # 5. Check Education Warning
    if template.has_education and len(education) == 0:
        gaps.append({
            "category": "education",
            "field": "education",
            "severity": "WARNING",
            "message": "Template includes an education section, but no education entries exist.",
            "suggested_fix": "Ask user for their university/degree details.",
        })
        suggested_questions.append("What university or degree program did you attend?")

    # Calculate Score
    total_checks = 5
    passed_checks = total_checks - len([g for g in gaps if g["severity"] == "BLOCKING"])
    score = max(0, int((passed_checks / total_checks) * 100) - (len([g for g in gaps if g["severity"] == "WARNING"]) * 5))

    is_ready = len(blocking_reasons) == 0

    if not is_ready:
        ai_action = "PROMPT_USER_FOR_MISSING_DATA"
        directive = (
            "DO NOT call generate_resume yet. The candidate profile lacks required items to satisfy this template. "
            "Interactively ask the user the clarifying questions below, call the appropriate add_project / add_experience / "
            "update_profile tools with the user's answers, and re-run check_readiness before generating."
        )
    elif gaps:
        ai_action = "PROMPT_OPTIONAL_IMPROVEMENTS_OR_GENERATE"
        directive = (
            "The profile satisfies minimum template requirements, but has quality warnings. "
            "You may either ask the user to fill the suggested fields to improve resume quality, or proceed with generate_resume."
        )
    else:
        ai_action = "PROCEED_TO_GENERATE"
        directive = "The candidate profile is complete and ready. You may proceed to call generate_resume."

    return {
        "is_ready": is_ready,
        "status": "READY" if is_ready else "BLOCKED",
        "score": score,
        "template_id": template_id,
        "required_split": {
            "projects": req_projects,
            "experience": req_experience,
        },
        "current_counts": {
            "projects": len(projects),
            "experiences": len(experiences),
            "education": len(education),
            "extracurriculars": len(extracurriculars),
        },
        "blocking_reasons": blocking_reasons,
        "gaps": gaps,
        "ai_steering": {
            "recommended_action": ai_action,
            "system_directive": directive,
            "suggested_questions": suggested_questions,
            "prefilled_stubs": {
                "add_project_example": {
                    "name": "<Project Name>",
                    "description": "<Overview>",
                    "technologies": ["<Tech 1>", "<Tech 2>"],
                    "bullet_points": ["<Action verb + measurable impact>"],
                },
                "add_experience_example": {
                    "role": "<Job Title>",
                    "organization": "<Company Name>",
                    "location": "<City, Country>",
                    "bullet_points": ["<Action verb + metric achievement>"],
                },
            },
        },
    }
