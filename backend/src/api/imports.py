from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, BackgroundTasks
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
import asyncio
import re
import time
import uuid
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.auth import get_current_user
from src.core.database import get_db, AsyncSessionLocal
from src.models.profile import Profile, UserEducation, UserExperience, UserProject, UserExtracurricular
from src.models.user import User
from src.schemas.profile import GitHubProjectDraft, GitHubProjectImportRequest, GitHubRepoItem, GitHubReposResponse, ImportApplyRequest, ResumeImportDraft
from src.services.github_client import GithubAuthError, GithubError, GithubNotFound, GithubRateLimited, github_get
from src.services.github_import import import_github_project
from src.services.github_tokens import get_github_identity, get_sync_token, mark_needs_reauth
from src.services.resume_import import (
    MAX_FILES,
    add_duplicates,
    extract_all_drafts,
    extract_resume_draft,
    extract_upload_text,
    load_existing_profile_data,
    merge_drafts,
)
from src.services.import_utils import (
    education_similarity,
    extracurricular_similarity,
    normalize_text,
    similar,
    unique_strings,
)
from src.services.import_jobs import import_jobs

router = APIRouter(prefix="/profile/import", tags=["profile-import"])

_GITHUB_USERNAME_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$")

RATE_LIMIT_DETAIL = "GitHub's shared limit is used up. Connect GitHub to keep importing."


def _validate_github_username(username: str) -> str:
    if not _GITHUB_USERNAME_RE.fullmatch(username):
        raise HTTPException(status_code=400, detail="Invalid GitHub username")
    return username


def _rate_limited_response(error: GithubRateLimited) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={"detail": RATE_LIMIT_DETAIL, "reset_at": error.reset_at.isoformat()},
    )


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
        if education_similarity(item.degree, item.institution, existing.degree, existing.institution) >= 0.80:
            return True
    seen.add(key)
    return False


def _extracurricular_exists(item, existing_extracurriculars: list[UserExtracurricular], seen: set[str]) -> bool:
    key = normalize_text(f"{item.title} {item.organization or ''}")
    if key in seen:
        return True
    for existing in existing_extracurriculars:
        if (
            extracurricular_similarity(
                item.title,
                item.organization,
                item.bullet_points or item.description,
                existing.title,
                existing.organization,
                existing.bullet_points or existing.description,
            )
            >= 0.78
        ):
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
    try:
        return await import_github_project(data.url, db, current_user)
    except GithubRateLimited as error:
        return _rate_limited_response(error)


@router.get("/github-repos", response_model=GitHubReposResponse)
async def get_github_user_repos(
    username: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    sync = await get_sync_token(db, current_user.id)

    if sync is not None:
        scopes = {part.strip() for part in (sync.scopes or "").split(",") if part.strip()}
        visibility = "all" if "repo" in scopes else "public"
        path = (
            "/user/repos?sort=updated&per_page=100"
            "&affiliation=owner,collaborator,organization_member"
            f"&visibility={visibility}"
        )
        try:
            data = await github_get(path, sync.token)
        except GithubRateLimited as error:
            return _rate_limited_response(error)
        except GithubAuthError:
            await mark_needs_reauth(db, sync.id)
            raise HTTPException(status_code=409, detail="Reconnect GitHub")
        except GithubNotFound:
            raise HTTPException(status_code=404, detail="GitHub user or repositories not found")
        except GithubError as error:
            raise HTTPException(status_code=400, detail=error.body_message or "Failed to fetch GitHub repositories")
        items = _repo_items(data)
        identity = await get_github_identity(db, current_user.id)
        login = identity.provider_login if identity is not None else None
        return GitHubReposResponse(repos=items, connected=True, github_username=login, source="token")

    cleaned_username = (username or "").strip()
    if not cleaned_username:
        return GitHubReposResponse(repos=[], connected=False, github_username=None, source="public")

    _validate_github_username(cleaned_username)
    path = f"/users/{cleaned_username}/repos?sort=updated&per_page=100"
    try:
        data = await github_get(path, None)
    except GithubRateLimited as error:
        return _rate_limited_response(error)
    except GithubNotFound:
        raise HTTPException(status_code=404, detail="GitHub user or repositories not found")
    except GithubError as error:
        raise HTTPException(status_code=400, detail=error.body_message or "Failed to fetch GitHub repositories")
    items = _repo_items(data)
    return GitHubReposResponse(repos=items, connected=False, github_username=cleaned_username, source="public")


def _repo_items(data) -> list[GitHubRepoItem]:
    items: list[GitHubRepoItem] = []
    if isinstance(data, list):
        for repo in data:
            if isinstance(repo, dict) and not repo.get("fork"):
                items.append(
                    GitHubRepoItem(
                        name=repo.get("name") or "",
                        full_name=repo.get("full_name") or "",
                        description=repo.get("description"),
                        html_url=repo.get("html_url") or "",
                        language=repo.get("language"),
                        stargazers_count=repo.get("stargazers_count") or 0,
                        updated_at=repo.get("updated_at"),
                        private=bool(repo.get("private")),
                    )
                )
    return items


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
    existing_extracurriculars = (await db.execute(select(UserExtracurricular).where(UserExtracurricular.user_id == current_user.id))).scalars().all()
    seen_projects: set[str] = set()
    seen_experiences: set[str] = set()
    seen_education: set[str] = set()
    seen_extracurriculars: set[str] = set()
    skipped = {"projects": 0, "experiences": 0, "education": 0, "extracurriculars": 0}

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
        if _extracurricular_exists(item, list(existing_extracurriculars), seen_extracurriculars):
            skipped["extracurriculars"] += 1
            continue
        db.add(UserExtracurricular(user_id=current_user.id, sort_order=item.sort_order or index, **item.model_dump(exclude={"sort_order"})))

    await db.commit()
    return {"ok": True, "skipped_duplicates": skipped}
