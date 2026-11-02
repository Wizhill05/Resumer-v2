from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.mcp.context import get_current_mcp_user, get_mcp_db
from src.models.profile import (
    Profile,
    UserEducation,
    UserExperience,
    UserExtracurricular,
    UserProject,
)
from src.services.content_split import resolve_default_split, split_is_allowed
from src.services.readiness import (
    MIN_DISTINCT_SKILLS,
    ProfileAssessment,
    SplitAvailability,
    assess_profile,
    find_split,
    readiness_next_steps,
    select_viable_split,
    split_availability,
)
from src.template_registry.service import TemplateRegistryService


async def list_templates_handler() -> dict[str, Any]:
    """List available resume templates with their layout manifests, content splits, and constraints."""
    user = get_current_mcp_user()
    templates = TemplateRegistryService.list_templates()
    return {
        "templates": [
            {
                "id": t.id,
                "name": t.name,
                "description": t.description,
                "target_pages": t.target_pages,
                "content_slots": t.content_slots,
                "default_content_split": resolve_default_split(user, t).model_dump(),
                "allowed_content_splits": [s.model_dump() for s in t.allowed_content_splits],
                "has_summary": t.has_summary,
                "has_education": t.has_education,
                "has_extracurricular": t.has_extracurricular,
            }
            for t in templates
        ]
    }


def _gap(
    field: str,
    message: str,
    *,
    category: str,
    severity: str,
    suggested_fix: str,
) -> dict[str, Any]:
    return {
        "category": category,
        "field": field,
        "severity": severity,
        "message": message,
        "suggested_fix": suggested_fix,
    }


def _identity_gap(field: str, message: str) -> tuple[dict[str, Any], str]:
    if field == "full_name":
        return (
            _gap(
                field,
                message,
                category="identity",
                severity="BLOCKING",
                suggested_fix="Ask user for their full name.",
            ),
            "What is your full name to display on the resume?",
        )
    if field == "email":
        return (
            _gap(
                field,
                message,
                category="identity",
                severity="BLOCKING",
                suggested_fix="Ask user for their contact email address.",
            ),
            "What email address should recruiters reach you at?",
        )
    if field == "professional_link":
        return (
            _gap(
                field,
                message,
                category="identity",
                severity="BLOCKING",
                suggested_fix="Ask user for a GitHub, LinkedIn, or portfolio URL.",
            ),
            "What GitHub, LinkedIn, or portfolio link should appear on your resume?",
        )
    return (
        _gap(
            field,
            message,
            category="skills",
            severity="BLOCKING",
            suggested_fix=f"Ask user for {MIN_DISTINCT_SKILLS} distinct skills to list.",
        ),
        f"Which {MIN_DISTINCT_SKILLS} skills should appear on your resume?",
    )


def _entry_gap(field: str, message: str) -> dict[str, Any]:
    category = "projects" if field.startswith("projects.") else "experiences"
    return _gap(
        field,
        message,
        category=category,
        severity="WARNING",
        suggested_fix=(
            "Ask user to complete this project's name/description or bullet points."
            if category == "projects"
            else "Ask user for at least one achievement bullet for this role."
        ),
    )


def _split_payload(split: SplitAvailability | None) -> dict[str, int] | None:
    if split is None:
        return None
    return {"projects": split.projects, "experience": split.experience}


def _split_options(availability: list[SplitAvailability]) -> list[dict[str, Any]]:
    return [
        {"projects": split.projects, "experience": split.experience, "label": split.label}
        for split in availability
        if split.is_available
    ]


def _blocking_split_reasons(
    template_id: str,
    requested_projects: int,
    requested_experience: int,
    assessment: ProfileAssessment,
) -> list[str]:
    reasons: list[str] = []
    if assessment.usable_project_count < requested_projects:
        reasons.append(
            f"Template '{template_id}' with split ({requested_projects} projects, "
            f"{requested_experience} experiences) requires at least {requested_projects} "
            f"usable project(s), but only {assessment.usable_project_count} found."
        )
    if assessment.usable_experience_count < requested_experience:
        reasons.append(
            f"Template '{template_id}' with split ({requested_projects} projects, "
            f"{requested_experience} experiences) requires at least {requested_experience} "
            f"usable experience(s), but only {assessment.usable_experience_count} found."
        )
    return reasons


def _split_gap(
    requested_projects: int,
    requested_experience: int,
    assessment: ProfileAssessment,
) -> dict[str, Any]:
    missing_projects = max(0, requested_projects - assessment.usable_project_count)
    missing_experiences = max(0, requested_experience - assessment.usable_experience_count)
    parts = []
    if missing_projects:
        parts.append(f"{missing_projects} usable project(s)")
    if missing_experiences:
        parts.append(f"{missing_experiences} usable experience(s)")
    return _gap(
        "content_split",
        f"Missing {' and '.join(parts)} for the requested layout.",
        category="content_split",
        severity="BLOCKING",
        suggested_fix=(
            "Ask user for the missing project/experience details, or choose an "
            "available split from available_splits."
        ),
    )


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
            "error": f"Template '{template_id}' not found.",
            "hint": "Call list_templates to view all available templates and their supported sections.",
            "blocking_reasons": [f"Template '{template_id}' not found."],
            "gaps": [],
            "ai_steering": {
                "recommended_action": "PROMPT_USER_FOR_VALID_TEMPLATE",
                "system_directive": f"Template '{template_id}' is invalid. Call list_templates to choose a valid template.",
                "suggested_questions": ["Which template would you like to use? (e.g. personal-classic)"],
            },
        }

    # Preserve explicit choice validation: an agent-supplied split must be one
    # of the template's allowed splits before we assess it.
    requested_projects: int | None = None
    requested_experience: int | None = None
    if content_split is not None:
        requested_projects = content_split.get("projects")
        requested_experience = content_split.get("experience")
        if (
            not isinstance(requested_projects, int)
            or not isinstance(requested_experience, int)
            or not split_is_allowed(requested_projects, requested_experience, template)
        ):
            allowed = [(s.projects, s.experience) for s in template.allowed_content_splits]
            message = (
                f"Invalid content_split ({requested_projects}, {requested_experience}) "
                f"for template '{template_id}'. Allowed splits (projects, experience): {allowed}"
            )
            return {
                "is_ready": False,
                "status": "BLOCKED",
                "score": 0,
                "template_id": template_id,
                "error_code": "INVALID_CONTENT_SPLIT",
                "error": message,
                "blocking_reasons": [message],
                "gaps": [
                    _gap(
                        "content_split",
                        message,
                        category="content_split",
                        severity="BLOCKING",
                        suggested_fix="Choose an allowed split from list_templates.",
                    )
                ],
                "hint": "Choose an allowed split from list_templates or omit content_split.",
                "ai_steering": {
                    "recommended_action": "PROMPT_USER_FOR_VALID_SPLIT",
                    "system_directive": (
                        f"{message} Ask the user to choose one of the allowed splits, "
                        "or omit content_split so generate_resume selects a viable split automatically."
                    ),
                    "suggested_questions": ["Which resume layout would you like to use?"],
                    "available_splits": [
                        {"projects": p, "experience": e, "label": label}
                        for p, e, label in (
                            (s.projects, s.experience, s.label)
                            for s in template.allowed_content_splits
                        )
                    ],
                },
            }

    async with get_mcp_db() as db:
        profile = (
            await db.execute(select(Profile).where(Profile.user_id == user.id))
        ).scalar_one_or_none()
        projects = (
            await db.execute(select(UserProject).where(UserProject.user_id == user.id))
        ).scalars().all()
        experiences = (
            await db.execute(select(UserExperience).where(UserExperience.user_id == user.id))
        ).scalars().all()
        education = (
            await db.execute(select(UserEducation).where(UserEducation.user_id == user.id))
        ).scalars().all()
        extracurriculars = (
            await db.execute(select(UserExtracurricular).where(UserExtracurricular.user_id == user.id))
        ).scalars().all()

    assessment = assess_profile(user, profile, projects, experiences)
    availability = split_availability(
        template, assessment.usable_project_count, assessment.usable_experience_count
    )
    preferred_split = resolve_default_split(user, template)

    requested_split: SplitAvailability | None = None
    if requested_projects is not None and requested_experience is not None:
        requested_split = find_split(availability, requested_projects, requested_experience)

    if requested_split is not None:
        selected_split = requested_split
    else:
        selected_split = select_viable_split(availability, preferred_split)

    split_ready = selected_split is not None and selected_split.is_available
    is_ready = assessment.is_profile_ready and split_ready

    blocking_reasons: list[str] = []
    gaps: list[dict[str, Any]] = []
    suggested_questions: list[str] = []

    # Identity, contact, professional link, and skills.
    for gap in assessment.blocking_gaps:
        gap_payload, question = _identity_gap(gap.field, gap.message)
        gaps.append(gap_payload)
        blocking_reasons.append(gap.message)
        if question not in suggested_questions:
            suggested_questions.append(question)

    # Incomplete extra entries are warnings, not blockers, when enough usable
    # entries exist for the selected split.
    for gap in assessment.entry_gaps:
        gaps.append(_entry_gap(gap.field, gap.message))

    # Project quality warnings (existing behaviour).
    for index, project in enumerate(projects):
        if not project.technologies or len(project.technologies) == 0:
            gaps.append(
                _gap(
                    f"projects[{index}].technologies",
                    f"Project '{project.name}' does not list technologies or frameworks used.",
                    category="project_quality",
                    severity="WARNING",
                    suggested_fix=f"Ask user what tech stack was used for '{project.name}'.",
                )
            )
            suggested_questions.append(
                f"What programming languages, frameworks, or databases did you use for '{project.name}'?"
            )

    # Education warning (existing behaviour).
    if template.has_education and len(education) == 0:
        gaps.append(
            _gap(
                "education",
                "Template includes an education section, but no education entries exist.",
                category="education",
                severity="WARNING",
                suggested_fix="Ask user for their university/degree details.",
            )
        )
        suggested_questions.append("What university or degree program did you attend?")

    if not split_ready:
        if requested_projects is not None and requested_experience is not None:
            blocking_reasons.extend(
                _blocking_split_reasons(
                    template_id,
                    requested_projects,
                    requested_experience,
                    assessment,
                )
            )
            gaps.append(
                _split_gap(requested_projects, requested_experience, assessment)
            )
            suggested_questions.append(
                f"This layout needs {requested_projects} projects and {requested_experience} "
                "work experiences. Could you share the missing details?"
            )
            if assessment.usable_project_count:
                suggested_questions.append(
                    f"You currently have {assessment.usable_project_count} usable project(s). "
                    f"We need {requested_projects} for this layout. Could you share details about another project you've worked on?"
                )
            if assessment.usable_experience_count:
                suggested_questions.append(
                    f"You currently have {assessment.usable_experience_count} usable work experience(s). "
                    f"We need {requested_experience} for this layout. Could you share another role, company, and key responsibilities?"
                )
        else:
            supported = ", ".join(
                f"({split.projects} projects, {split.experience} experiences)"
                for split in availability
            )
            message = (
                "No supported content split is currently satisfied: "
                f"{assessment.usable_project_count} usable project(s) and "
                f"{assessment.usable_experience_count} usable experience(s) found. "
                f"Supported splits (projects, experience): {supported or 'none'}."
            )
            blocking_reasons.append(message)
            gaps.append(
                _gap(
                    "content_split",
                    "Add or complete projects and experiences to meet one of the supported splits.",
                    category="content_split",
                    severity="BLOCKING",
                    suggested_fix=(
                        "Ask user for enough project/experience details to satisfy at least one split."
                    ),
                )
            )
            suggested_questions.append(
                "Could you share more project or work experience details so we can build your resume?"
            )

    total_checks = 5
    blocking_count = len({gap["category"] for gap in gaps if gap["severity"] == "BLOCKING"})
    warning_count = len([gap for gap in gaps if gap["severity"] == "WARNING"])
    score = max(0, int(((total_checks - min(total_checks, blocking_count)) / total_checks) * 100) - warning_count * 5)

    available_splits = _split_options(availability)
    default_payload = {
        "projects": preferred_split.projects,
        "experience": preferred_split.experience,
    }
    required_payload = _split_payload(selected_split) or default_payload
    split_auto_selected = bool(
        requested_projects is None
        and selected_split is not None
        and (
            selected_split.projects != preferred_split.projects
            or selected_split.experience != preferred_split.experience
        )
    )

    if not is_ready:
        ai_action = "PROMPT_USER_FOR_MISSING_DATA"
        directive = (
            "DO NOT call generate_resume yet. The candidate profile lacks required items to satisfy this template. "
            "Interactively ask the user the clarifying questions below, call the appropriate add_project / add_experience / "
            "update_profile tools with the user's answers, and re-run check_readiness before generating."
        )
        if requested_projects is not None and available_splits:
            directive += (
                f" The requested split ({requested_projects} projects, {requested_experience} experiences) "
                "is not supported by the current entries, but these splits are available: "
                f"{available_splits}. Ask the user whether to use one, or omit content_split so "
                "generate_resume selects a viable split automatically."
            )
    elif split_auto_selected:
        ai_action = "PROCEED_TO_GENERATE"
        directive = (
            "The profile satisfies readiness criteria. The preferred/default split "
            f"({preferred_split.projects} projects, {preferred_split.experience} experiences) is not supported "
            f"by the current entries, so generate_resume will automatically use the viable split "
            f"({required_payload['projects']} projects, {required_payload['experience']} experiences). "
            "Call generate_resume without content_split to use it, or pass one of available_splits explicitly."
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

    directive += " " + readiness_next_steps(is_ready)

    response_data: dict[str, Any] = {
        "is_ready": is_ready,
        "status": "READY" if is_ready else "BLOCKED",
        "score": score,
        "template_id": template_id,
        "required_split": required_payload,
        "default_split": default_payload,
        "split_auto_selected": split_auto_selected,
        "available_splits": available_splits,
        "supported_splits": [split.as_dict() for split in availability],
        "current_counts": {
            "projects": len(projects),
            "experiences": len(experiences),
            "education": len(education),
            "extracurriculars": len(extracurriculars),
            "usable_projects": assessment.usable_project_count,
            "usable_experiences": assessment.usable_experience_count,
            "skills": assessment.skills_count,
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

    if not is_ready:
        response_data["error"] = "Profile does not meet template requirements."
        response_data["hint"] = (
            "Add your missing work history or projects first via add_project or add_experience before generating."
        )

    return response_data
