from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, BackgroundTasks
from fastapi.encoders import jsonable_encoder
import asyncio
import time
import uuid
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.auth import get_current_user
from src.core.database import get_db, AsyncSessionLocal
from src.models.profile import Profile, UserEducation, UserExperience, UserProject, UserExtracurricular
from src.models.user import User
from src.schemas.profile import GitHubProjectDraft, GitHubProjectImportRequest, ImportApplyRequest, ResumeImportDraft
from src.services.github_import import import_github_project
from src.services.resume_import import (
    MAX_FILES,
    add_duplicates,
    extract_all_drafts,
    extract_resume_draft,
    extract_upload_text,
    load_existing_profile_data,
    merge_drafts,
)
from src.services.import_utils import unique_strings
from src.services.import_utils import normalize_text, similar
from src.services.import_jobs import import_jobs

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


class ParsedTexts(BaseModel):
    texts: list[str]
    filenames: list[str]


@router.post("/parse", response_model=ParsedTexts)
async def parse_resumes(
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
):
    """Stage 1: parse PDFs to raw text. Fast, no LLM."""
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"Upload {MAX_FILES} resumes or fewer")
    texts = []
    filenames = []
    for file in files:
        text = await extract_upload_text(file)
        texts.append(text)
        filenames.append(file.filename or "resume")
    return ParsedTexts(texts=texts, filenames=filenames)


@router.post("/extract", response_model=ResumeImportDraft)
async def extract_resumes(
    data: ParsedTexts,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Stage 2: run LLM extraction on pre-parsed texts (parallel), return merged draft."""
    tasks = [extract_resume_draft(text, filename) for text, filename in zip(data.texts, data.filenames)]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    drafts = []
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            print(f"[import/extract] skipping {data.filenames[i]}: {result}")
            if len(data.texts) == 1:
                raise result
        else:
            drafts.append(result)

    if not drafts:
        raise HTTPException(status_code=502, detail="Could not extract data from any of the uploaded resumes.")

    draft = merge_drafts(drafts)
    return add_duplicates(draft, await load_existing_profile_data(db, current_user))


async def run_auth_import_task(job_id: str, texts: list[str], filenames: list[str], user_id: uuid.UUID):
    try:
        import_jobs[job_id]["status"] = "extracting"
        tasks = [extract_resume_draft(text, filename) for text, filename in zip(texts, filenames)]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        drafts = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                print(f"[auth/import/task] skipping {filenames[i]}: {result}")
                if len(texts) == 1:
                    raise result
            else:
                drafts.append(result)

        if not drafts:
            raise Exception("Could not extract data from any of the uploaded resumes.")

        import_jobs[job_id]["status"] = "deduplicating"
        await asyncio.sleep(1.0)  # Visual separation of stage for UI

        merged = merge_drafts(drafts)

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(User).where(User.id == user_id))
            current_user = result.scalar_one()
            profile_data = await load_existing_profile_data(db, current_user)
            final_draft = add_duplicates(merged, profile_data)

        import_jobs[job_id]["result"] = jsonable_encoder(final_draft)
        import_jobs[job_id]["status"] = "completed"
    except Exception as e:
        import_jobs[job_id]["error"] = str(e)
        import_jobs[job_id]["status"] = "failed"


@router.post("/start")
async def start_auth_import(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
):
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"Upload {MAX_FILES} resumes or fewer")

    texts = []
    filenames = []
    for file in files:
        text = await extract_upload_text(file)
        texts.append(text)
        filenames.append(file.filename or "resume")

    job_id = str(uuid.uuid4())
    import_jobs[job_id] = {
        "id": job_id,
        "status": "parsing",
        "result": None,
        "error": None,
        "created_at": time.time(),
    }

    background_tasks.add_task(run_auth_import_task, job_id, texts, filenames, current_user.id)
    return {"job_id": job_id}


@router.get("/status/{job_id}")
async def get_auth_import_status(
    job_id: str,
    current_user: User = Depends(get_current_user),
):
    if job_id not in import_jobs:
        raise HTTPException(status_code=404, detail="Import job not found")
    return import_jobs[job_id]


@router.post("/resumes", response_model=ResumeImportDraft)
async def import_resumes(
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"Upload {MAX_FILES} resumes or fewer")
    drafts = await extract_all_drafts(files)
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
