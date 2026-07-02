from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.auth import get_current_user
from src.core.database import get_db
from src.models.profile import Profile, UserEducation, UserExperience, UserProject, UserExtracurricular
from src.models.user import User
from src.schemas.profile import GitHubProjectDraft, GitHubProjectImportRequest, ImportApplyRequest, ResumeImportDraft
from src.services.github_import import import_github_project
from src.services.resume_import import (
    MAX_FILES,
    add_duplicates,
    extract_resume_draft,
    extract_upload_text,
    load_existing_profile_data,
    merge_drafts,
)
from src.services.import_utils import unique_strings
from src.services.import_utils import normalize_text, similar

router = APIRouter(prefix="/profile/import", tags=["profile-import"])


def _project_exists(item, existing_projects: list[UserProject], seen: set[str]) -> bool:
    key = normalize_text(item.github_url or item.name)
    if key in seen:
        return True
    for existing in existing_projects:
        same_url = item.github_url and existing.github_url and item.github_url.rstrip("/").lower() == existing.github_url.rstrip("/").lower()
        if same_url or similar(item.name, existing.name) >= 0.86:
            return True
    seen.add(key)
    return False


def _experience_exists(item, existing_experiences: list[UserExperience], seen: set[str]) -> bool:
    key = normalize_text(f"{item.role} {item.organization}")
    if key in seen:
        return True
    for existing in existing_experiences:
        confidence = (similar(item.role, existing.role) + similar(item.organization, existing.organization)) / 2
        if confidence >= 0.86:
            return True
    seen.add(key)
    return False


def _education_exists(item, existing_education: list[UserEducation], seen: set[str]) -> bool:
    key = normalize_text(f"{item.degree} {item.institution}")
    if key in seen:
        return True
    for existing in existing_education:
        confidence = (similar(item.degree, existing.degree) + similar(item.institution, existing.institution)) / 2
        if confidence >= 0.86:
            return True
    seen.add(key)
    return False


@router.post("/resume", response_model=ResumeImportDraft)
async def import_resume(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    text = await extract_upload_text(file)
    draft = await extract_resume_draft(text)
    return add_duplicates(draft, await load_existing_profile_data(db, current_user))


@router.post("/resumes", response_model=ResumeImportDraft)
async def import_resumes(
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if len(files) > MAX_FILES:
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail=f"Upload {MAX_FILES} resumes or fewer")
    drafts = []
    for file in files:
        text = await extract_upload_text(file)
        drafts.append(await extract_resume_draft(text))
    draft = merge_drafts(drafts)
    return add_duplicates(draft, await load_existing_profile_data(db, current_user))


@router.post("/github-project", response_model=GitHubProjectDraft)
async def import_github_project_route(
    data: GitHubProjectImportRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await import_github_project(data.url, db, current_user)


@router.post("/apply")
async def apply_import(
    data: ImportApplyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Profile).where(Profile.user_id == current_user.id))
    profile = result.scalar_one_or_none()
    if not profile:
        profile = Profile(user_id=current_user.id)
        db.add(profile)

    if data.profile:
        for field, value in data.profile.model_dump(exclude_unset=True).items():
            if field == "skills":
                profile.skills = unique_strings((profile.skills or []) + (value or []))
            elif value and not getattr(profile, field):
                setattr(profile, field, value)

    existing_projects = (await db.execute(select(UserProject).where(UserProject.user_id == current_user.id))).scalars().all()
    existing_experiences = (await db.execute(select(UserExperience).where(UserExperience.user_id == current_user.id))).scalars().all()
    existing_education = (await db.execute(select(UserEducation).where(UserEducation.user_id == current_user.id))).scalars().all()
    seen_projects: set[str] = set()
    seen_experiences: set[str] = set()
    seen_education: set[str] = set()
    skipped = {"projects": 0, "experiences": 0, "education": 0}

    for index, item in enumerate(data.projects):
        if _project_exists(item, list(existing_projects), seen_projects):
            skipped["projects"] += 1
            continue
        db.add(UserProject(user_id=current_user.id, source="resume_import" if not item.github_url else "github_import", sort_order=item.sort_order or index, **item.model_dump(exclude={"sort_order"})))
    for index, item in enumerate(data.experiences):
        if _experience_exists(item, list(existing_experiences), seen_experiences):
            skipped["experiences"] += 1
            continue
        db.add(UserExperience(user_id=current_user.id, source="resume_import", sort_order=item.sort_order or index, **item.model_dump(exclude={"sort_order"})))
    for index, item in enumerate(data.education):
        if _education_exists(item, list(existing_education), seen_education):
            skipped["education"] += 1
            continue
        db.add(UserEducation(user_id=current_user.id, sort_order=item.sort_order or index, **item.model_dump(exclude={"sort_order"})))
    for index, item in enumerate(data.extracurriculars):
        db.add(UserExtracurricular(user_id=current_user.id, sort_order=item.sort_order or index, **item.model_dump(exclude={"sort_order"})))

    await db.commit()
    return {"ok": True, "skipped_duplicates": skipped}
