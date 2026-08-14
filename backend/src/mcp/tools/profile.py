from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.mcp.context import get_current_mcp_user, get_mcp_db
from src.models.profile import (
    Profile,
    UserEducation,
    UserExperience,
    UserExtracurricular,
    UserProject,
)
from src.models.user import User


def parse_date(date_str: str | None) -> date | None:
    """Safely parse YYYY-MM-DD date string."""
    if not date_str:
        return None
    try:
        return date.fromisoformat(date_str.strip())
    except (ValueError, TypeError):
        return None


def serialize_entity(obj: Any) -> dict[str, Any]:
    """Serialize SQLAlchemy model instance to clean JSON dict."""
    if obj is None:
        return {}
    res = {}
    for col in obj.__table__.columns:
        val = getattr(obj, col.name)
        if isinstance(val, (uuid.UUID, date, datetime)):
            res[col.name] = str(val)
        else:
            res[col.name] = val
    return res


# --- Profile & Data Summary ---

async def get_profile_handler() -> dict[str, Any]:
    """Retrieve complete profile, projects, experiences, education, and extracurriculars for the user."""
    user = get_current_mcp_user()
    async with get_mcp_db() as db:
        # Base Profile
        res = await db.execute(select(Profile).where(Profile.user_id == user.id))
        profile = res.scalar_one_or_none()

        # Projects
        res_proj = await db.execute(
            select(UserProject).where(UserProject.user_id == user.id).order_by(UserProject.sort_order.asc(), UserProject.created_at.desc())
        )
        projects = res_proj.scalars().all()

        # Experience
        res_exp = await db.execute(
            select(UserExperience).where(UserExperience.user_id == user.id).order_by(UserExperience.sort_order.asc(), UserExperience.created_at.desc())
        )
        experiences = res_exp.scalars().all()

        # Education
        res_edu = await db.execute(
            select(UserEducation).where(UserEducation.user_id == user.id).order_by(UserEducation.sort_order.asc(), UserEducation.created_at.desc())
        )
        education = res_edu.scalars().all()

        # Extracurriculars
        res_extra = await db.execute(
            select(UserExtracurricular).where(UserExtracurricular.user_id == user.id).order_by(UserExtracurricular.sort_order.asc(), UserExtracurricular.created_at.desc())
        )
        extracurriculars = res_extra.scalars().all()

        return {
            "user": {
                "id": str(user.id),
                "email": user.email,
                "name": user.name,
            },
            "profile": serialize_entity(profile) if profile else {
                "full_name": user.name,
                "email": user.email,
                "skills": [],
            },
            "projects": [serialize_entity(p) for p in projects],
            "experiences": [serialize_entity(e) for e in experiences],
            "education": [serialize_entity(ed) for ed in education],
            "extracurriculars": [serialize_entity(ex) for ex in extracurriculars],
            "counts": {
                "projects": len(projects),
                "experiences": len(experiences),
                "education": len(education),
                "extracurriculars": len(extracurriculars),
            },
        }


async def list_data_summary_handler() -> dict[str, Any]:
    """Return concise statistics, completeness percentage, and gaps for user's profile."""
    user = get_current_mcp_user()
    async with get_mcp_db() as db:
        res = await db.execute(select(Profile).where(Profile.user_id == user.id))
        profile = res.scalar_one_or_none()

        proj_count = (await db.execute(select(func.count()).select_from(UserProject).where(UserProject.user_id == user.id))).scalar() or 0
        exp_count = (await db.execute(select(func.count()).select_from(UserExperience).where(UserExperience.user_id == user.id))).scalar() or 0
        edu_count = (await db.execute(select(func.count()).select_from(UserEducation).where(UserEducation.user_id == user.id))).scalar() or 0
        extra_count = (await db.execute(select(func.count()).select_from(UserExtracurricular).where(UserExtracurricular.user_id == user.id))).scalar() or 0

        # Calculate completeness score
        score = 0
        gaps = []
        if profile and profile.full_name:
            score += 15
        else:
            gaps.append("Missing full name in profile")

        if profile and profile.email:
            score += 10
        else:
            gaps.append("Missing contact email")

        if profile and profile.skills and len(profile.skills) >= 3:
            score += 15
        else:
            gaps.append("Profile has fewer than 3 technical skills")

        if proj_count >= 2:
            score += 25
        elif proj_count == 1:
            score += 15
            gaps.append("Only 1 project added (most templates recommend at least 2)")
        else:
            gaps.append("No projects added yet")

        if exp_count >= 2:
            score += 20
        elif exp_count == 1:
            score += 10
            gaps.append("Only 1 experience added (2 recommended for classic splits)")
        else:
            gaps.append("No work experience added yet")

        if edu_count >= 1:
            score += 15
        else:
            gaps.append("No education entries added")

        return {
            "completeness_score": min(score, 100),
            "counts": {
                "projects": proj_count,
                "experiences": exp_count,
                "education": edu_count,
                "extracurriculars": extra_count,
            },
            "gaps": gaps,
            "status": "ready" if score >= 70 and proj_count >= 1 else "needs_data",
        }


async def update_profile_handler(
    full_name: str | None = None,
    email: str | None = None,
    phone: str | None = None,
    location: str | None = None,
    linkedin_url: str | None = None,
    github_url: str | None = None,
    portfolio_url: str | None = None,
    subtitle: str | None = None,
    summary: str | None = None,
    skills: list[str] | None = None,
) -> dict[str, Any]:
    """Update profile contact details, summary, and skills."""
    user = get_current_mcp_user()
    async with get_mcp_db() as db:
        res = await db.execute(select(Profile).where(Profile.user_id == user.id))
        profile = res.scalar_one_or_none()

        if not profile:
            profile = Profile(
                user_id=user.id,
                full_name=full_name or user.name,
                email=email or user.email,
                phone=phone,
                location=location,
                linkedin_url=linkedin_url,
                github_url=github_url,
                portfolio_url=portfolio_url,
                subtitle=subtitle,
                summary=summary,
                skills=skills or [],
            )
            db.add(profile)
        else:
            if full_name is not None:
                profile.full_name = full_name
            if email is not None:
                profile.email = email
            if phone is not None:
                profile.phone = phone
            if location is not None:
                profile.location = location
            if linkedin_url is not None:
                profile.linkedin_url = linkedin_url
            if github_url is not None:
                profile.github_url = github_url
            if portfolio_url is not None:
                profile.portfolio_url = portfolio_url
            if subtitle is not None:
                profile.subtitle = subtitle
            if summary is not None:
                profile.summary = summary
            if skills is not None:
                profile.skills = skills

        await db.commit()
        await db.refresh(profile)
        return {"success": True, "profile": serialize_entity(profile)}


# --- Projects CRUD ---

async def add_project_handler(
    name: str,
    description: str | None = None,
    technologies: list[str] | None = None,
    github_url: str | None = None,
    live_url: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    bullet_points: list[str] | None = None,
) -> dict[str, Any]:
    """Add a new software project to the user's profile."""
    user = get_current_mcp_user()
    async with get_mcp_db() as db:
        proj = UserProject(
            user_id=user.id,
            name=name,
            description=description,
            technologies=technologies or [],
            github_url=github_url,
            live_url=live_url,
            start_date=parse_date(start_date),
            end_date=parse_date(end_date),
            bullet_points=bullet_points or [],
            source="mcp",
        )
        db.add(proj)
        await db.commit()
        await db.refresh(proj)
        return {"success": True, "project": serialize_entity(proj)}


async def update_project_handler(
    project_id: str,
    name: str | None = None,
    description: str | None = None,
    technologies: list[str] | None = None,
    github_url: str | None = None,
    live_url: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    bullet_points: list[str] | None = None,
) -> dict[str, Any]:
    """Update an existing project by project_id."""
    user = get_current_mcp_user()
    proj_uuid = uuid.UUID(project_id)
    async with get_mcp_db() as db:
        res = await db.execute(
            select(UserProject).where(UserProject.id == proj_uuid, UserProject.user_id == user.id)
        )
        proj = res.scalar_one_or_none()
        if not proj:
            return {"success": False, "error": f"Project {project_id} not found"}

        if name is not None:
            proj.name = name
        if description is not None:
            proj.description = description
        if technologies is not None:
            proj.technologies = technologies
        if github_url is not None:
            proj.github_url = github_url
        if live_url is not None:
            proj.live_url = live_url
        if start_date is not None:
            proj.start_date = parse_date(start_date)
        if end_date is not None:
            proj.end_date = parse_date(end_date)
        if bullet_points is not None:
            proj.bullet_points = bullet_points

        await db.commit()
        await db.refresh(proj)
        return {"success": True, "project": serialize_entity(proj)}


async def delete_project_handler(project_id: str) -> dict[str, Any]:
    """Delete a project from profile."""
    user = get_current_mcp_user()
    proj_uuid = uuid.UUID(project_id)
    async with get_mcp_db() as db:
        res = await db.execute(
            delete(UserProject).where(UserProject.id == proj_uuid, UserProject.user_id == user.id)
        )
        await db.commit()
        return {"success": res.rowcount > 0, "deleted_id": project_id}


# --- Experience CRUD ---

async def add_experience_handler(
    role: str,
    organization: str,
    location: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    bullet_points: list[str] | None = None,
) -> dict[str, Any]:
    """Add a work experience entry to the user's profile."""
    user = get_current_mcp_user()
    async with get_mcp_db() as db:
        exp = UserExperience(
            user_id=user.id,
            role=role,
            organization=organization,
            location=location,
            start_date=parse_date(start_date),
            end_date=parse_date(end_date),
            bullet_points=bullet_points or [],
            source="mcp",
        )
        db.add(exp)
        await db.commit()
        await db.refresh(exp)
        return {"success": True, "experience": serialize_entity(exp)}


async def update_experience_handler(
    experience_id: str,
    role: str | None = None,
    organization: str | None = None,
    location: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    bullet_points: list[str] | None = None,
) -> dict[str, Any]:
    """Update an existing work experience entry."""
    user = get_current_mcp_user()
    exp_uuid = uuid.UUID(experience_id)
    async with get_mcp_db() as db:
        res = await db.execute(
            select(UserExperience).where(UserExperience.id == exp_uuid, UserExperience.user_id == user.id)
        )
        exp = res.scalar_one_or_none()
        if not exp:
            return {"success": False, "error": f"Experience {experience_id} not found"}

        if role is not None:
            exp.role = role
        if organization is not None:
            exp.organization = organization
        if location is not None:
            exp.location = location
        if start_date is not None:
            exp.start_date = parse_date(start_date)
        if end_date is not None:
            exp.end_date = parse_date(end_date)
        if bullet_points is not None:
            exp.bullet_points = bullet_points

        await db.commit()
        await db.refresh(exp)
        return {"success": True, "experience": serialize_entity(exp)}


async def delete_experience_handler(experience_id: str) -> dict[str, Any]:
    """Remove a work experience entry."""
    user = get_current_mcp_user()
    exp_uuid = uuid.UUID(experience_id)
    async with get_mcp_db() as db:
        res = await db.execute(
            delete(UserExperience).where(UserExperience.id == exp_uuid, UserExperience.user_id == user.id)
        )
        await db.commit()
        return {"success": res.rowcount > 0, "deleted_id": experience_id}


# --- Education CRUD ---

async def add_education_handler(
    degree: str,
    institution: str,
    location: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    gpa: str | None = None,
    coursework: list[str] | None = None,
) -> dict[str, Any]:
    """Add an education record to user profile."""
    user = get_current_mcp_user()
    async with get_mcp_db() as db:
        edu = UserEducation(
            user_id=user.id,
            degree=degree,
            institution=institution,
            location=location,
            start_date=parse_date(start_date),
            end_date=parse_date(end_date),
            gpa=gpa,
            coursework=coursework or [],
        )
        db.add(edu)
        await db.commit()
        await db.refresh(edu)
        return {"success": True, "education": serialize_entity(edu)}


async def update_education_handler(
    education_id: str,
    degree: str | None = None,
    institution: str | None = None,
    location: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    gpa: str | None = None,
    coursework: list[str] | None = None,
) -> dict[str, Any]:
    """Update an education entry."""
    user = get_current_mcp_user()
    edu_uuid = uuid.UUID(education_id)
    async with get_mcp_db() as db:
        res = await db.execute(
            select(UserEducation).where(UserEducation.id == edu_uuid, UserEducation.user_id == user.id)
        )
        edu = res.scalar_one_or_none()
        if not edu:
            return {"success": False, "error": f"Education {education_id} not found"}

        if degree is not None:
            edu.degree = degree
        if institution is not None:
            edu.institution = institution
        if location is not None:
            edu.location = location
        if start_date is not None:
            edu.start_date = parse_date(start_date)
        if end_date is not None:
            edu.end_date = parse_date(end_date)
        if gpa is not None:
            edu.gpa = gpa
        if coursework is not None:
            edu.coursework = coursework

        await db.commit()
        await db.refresh(edu)
        return {"success": True, "education": serialize_entity(edu)}


async def delete_education_handler(education_id: str) -> dict[str, Any]:
    """Delete an education record."""
    user = get_current_mcp_user()
    edu_uuid = uuid.UUID(education_id)
    async with get_mcp_db() as db:
        res = await db.execute(
            delete(UserEducation).where(UserEducation.id == edu_uuid, UserEducation.user_id == user.id)
        )
        await db.commit()
        return {"success": res.rowcount > 0, "deleted_id": education_id}


# --- Extracurricular CRUD ---

async def add_extracurricular_handler(
    title: str,
    organization: str | None = None,
    description: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    bullet_points: list[str] | None = None,
) -> dict[str, Any]:
    """Add an extracurricular leadership or activity entry."""
    user = get_current_mcp_user()
    async with get_mcp_db() as db:
        extra = UserExtracurricular(
            user_id=user.id,
            title=title,
            organization=organization,
            description=description,
            start_date=parse_date(start_date),
            end_date=parse_date(end_date),
            bullet_points=bullet_points or [],
        )
        db.add(extra)
        await db.commit()
        await db.refresh(extra)
        return {"success": True, "extracurricular": serialize_entity(extra)}


async def update_extracurricular_handler(
    extracurricular_id: str,
    title: str | None = None,
    organization: str | None = None,
    description: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    bullet_points: list[str] | None = None,
) -> dict[str, Any]:
    """Update an extracurricular entry."""
    user = get_current_mcp_user()
    extra_uuid = uuid.UUID(extracurricular_id)
    async with get_mcp_db() as db:
        res = await db.execute(
            select(UserExtracurricular).where(UserExtracurricular.id == extra_uuid, UserExtracurricular.user_id == user.id)
        )
        extra = res.scalar_one_or_none()
        if not extra:
            return {"success": False, "error": f"Extracurricular {extracurricular_id} not found"}

        if title is not None:
            extra.title = title
        if organization is not None:
            extra.organization = organization
        if description is not None:
            extra.description = description
        if start_date is not None:
            extra.start_date = parse_date(start_date)
        if end_date is not None:
            extra.end_date = parse_date(end_date)
        if bullet_points is not None:
            extra.bullet_points = bullet_points

        await db.commit()
        await db.refresh(extra)
        return {"success": True, "extracurricular": serialize_entity(extra)}


async def delete_extracurricular_handler(extracurricular_id: str) -> dict[str, Any]:
    """Delete an extracurricular entry."""
    user = get_current_mcp_user()
    extra_uuid = uuid.UUID(extracurricular_id)
    async with get_mcp_db() as db:
        res = await db.execute(
            delete(UserExtracurricular).where(UserExtracurricular.id == extra_uuid, UserExtracurricular.user_id == user.id)
        )
        await db.commit()
        return {"success": res.rowcount > 0, "deleted_id": extracurricular_id}
