import asyncio
import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Cookie, Depends, File, HTTPException, Response, UploadFile, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import case, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.executor import trigger_pipeline
from src.core.storage import StorageService
from src.models.generation import Generation, GenerationLog, GuestRateLimit
from src.models.user import User
from src.schemas.guest import GuestGenerationCreate, GuestGenerationOut
from src.schemas.profile import ResumeImportDraft
from src.services.resume_import import MAX_FILES, extract_all_drafts, extract_resume_draft, extract_upload_text, merge_drafts
from src.template_registry.service import TemplateRegistryService

router = APIRouter(prefix="/guest", tags=["guest"])

GUEST_COOKIE = "resumer_guest_token"
CONSENT_COOKIE = "resumer_guest_consent"
GUEST_USER_EMAIL = "__guest__@resumer.local"
GUEST_MAX_DAILY_RUNS = 5
GUEST_TOKEN_DAYS = 7
GUEST_ARTIFACT_DAYS = 7


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _require_consent(consent: str | None) -> None:
    if consent != "true":
        raise HTTPException(status_code=403, detail="Cookie consent required for anonymous trial")


def _set_guest_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        GUEST_COOKIE,
        token,
        max_age=GUEST_TOKEN_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=True,
        samesite="lax",
    )


def _guest_token(response: Response, consent: str | None, token: str | None) -> str:
    _require_consent(consent)
    if token:
        return token
    new_token = secrets.token_urlsafe(32)
    _set_guest_cookie(response, new_token)
    return new_token


async def _guest_user(db: AsyncSession) -> User:
    result = await db.execute(select(User).where(User.email == GUEST_USER_EMAIL))
    user = result.scalar_one_or_none()
    if user:
        return user
    user = User(email=GUEST_USER_EMAIL, name="Guest", provider="guest")
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _check_guest_rate_limit(token_hash: str, db: AsyncSession) -> None:
    now = datetime.now(timezone.utc)
    reset_at = now + timedelta(hours=24)
    stmt = (
        pg_insert(GuestRateLimit)
        .values(token_hash=token_hash, request_count=1, reset_at=reset_at)
        .on_conflict_do_update(
            index_elements=[GuestRateLimit.token_hash],
            set_={
                "request_count": case(
                    (GuestRateLimit.reset_at <= now, 1),
                    else_=GuestRateLimit.request_count + 1,
                ),
                "reset_at": case(
                    (GuestRateLimit.reset_at <= now, reset_at),
                    else_=GuestRateLimit.reset_at,
                ),
            },
        )
        .returning(GuestRateLimit.request_count, GuestRateLimit.reset_at)
    )
    result = await db.execute(stmt)
    count, reset = result.one()
    await db.commit()
    if count > GUEST_MAX_DAILY_RUNS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit: {GUEST_MAX_DAILY_RUNS} guest resumes per day. Resets at {reset.isoformat()}",
        )


async def _guest_generation(gen_id: str, token_hash: str, db: AsyncSession) -> Generation:
    result = await db.execute(
        select(Generation).where(
            Generation.id == uuid.UUID(gen_id),
            Generation.is_guest == True,  # noqa: E712
            Generation.guest_token_hash == token_hash,
        )
    )
    gen = result.scalar_one_or_none()
    if not gen:
        raise HTTPException(status_code=404, detail="Generation not found")
    return gen


def _out(gen: Generation) -> GuestGenerationOut:
    return GuestGenerationOut(
        id=str(gen.id),
        template_id=gen.template_id,
        job_title=gen.job_title,
        company=gen.company,
        status=gen.status,
        model_used=gen.model_used,
        created_at=gen.created_at.isoformat(),
        completed_at=gen.completed_at.isoformat() if gen.completed_at else None,
        content_split=gen.content_split,
        error_message=gen.error_message,
    )




class ParsedTexts(BaseModel):
    texts: list[str]
    filenames: list[str]


@router.post("/import/parse", response_model=ParsedTexts)
async def parse_guest_resumes(
    response: Response,
    files: list[UploadFile] = File(...),
    resumer_guest_consent: str | None = Cookie(default=None, alias=CONSENT_COOKIE),
    resumer_guest_token: str | None = Cookie(default=None, alias=GUEST_COOKIE),
):
    """Stage 1: parse PDFs to raw text. Fast, no LLM."""
    _guest_token(response, resumer_guest_consent, resumer_guest_token)
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"Upload {MAX_FILES} resumes or fewer")
    texts = []
    filenames = []
    for file in files:
        text = await extract_upload_text(file)
        texts.append(text)
        filenames.append(file.filename or "resume")
    return ParsedTexts(texts=texts, filenames=filenames)


@router.post("/import/extract", response_model=ResumeImportDraft)
async def extract_guest_resumes(
    data: ParsedTexts,
    response: Response,
    resumer_guest_consent: str | None = Cookie(default=None, alias=CONSENT_COOKIE),
    resumer_guest_token: str | None = Cookie(default=None, alias=GUEST_COOKIE),
):
    """Stage 2: run LLM extraction on pre-parsed texts (parallel), return merged draft."""
    _guest_token(response, resumer_guest_consent, resumer_guest_token)
    tasks = [extract_resume_draft(text, filename) for text, filename in zip(data.texts, data.filenames)]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    drafts = []
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            print(f"[guest/import/extract] skipping {data.filenames[i]}: {result}")
            if len(data.texts) == 1:
                raise result
        else:
            drafts.append(result)

    if not drafts:
        raise HTTPException(status_code=502, detail="Could not extract data from any of the uploaded resumes.")

    return merge_drafts(drafts)


@router.post("/import/resumes", response_model=ResumeImportDraft)
async def import_guest_resumes(
    response: Response,
    files: list[UploadFile] = File(...),
    resumer_guest_consent: str | None = Cookie(default=None, alias=CONSENT_COOKIE),
    resumer_guest_token: str | None = Cookie(default=None, alias=GUEST_COOKIE),
):
    _guest_token(response, resumer_guest_consent, resumer_guest_token)
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"Upload {MAX_FILES} resumes or fewer")
    drafts = await extract_all_drafts(files)
    return merge_drafts(drafts)


@router.post("/generate", response_model=GuestGenerationOut)
async def start_guest_generation(
    data: GuestGenerationCreate,
    response: Response,
    resumer_guest_consent: str | None = Cookie(default=None, alias=CONSENT_COOKIE),
    resumer_guest_token: str | None = Cookie(default=None, alias=GUEST_COOKIE),
    db: AsyncSession = Depends(get_db),
):
    token = _guest_token(response, resumer_guest_consent, resumer_guest_token)
    token_hash = _hash_token(token)
    await _check_guest_rate_limit(token_hash, db)

    manifest = TemplateRegistryService.get_template_manifest(data.template_id)
    if not manifest:
        raise HTTPException(status_code=422, detail=f"Template '{data.template_id}' not found.")

    if data.content_split is not None:
        allowed = [(s.projects, s.experience) for s in manifest.allowed_content_splits]
        req = (data.content_split.projects, data.content_split.experience)
        if req not in allowed:
            raise HTTPException(status_code=422, detail=f"Invalid content_split {req}. Allowed: {allowed}")
        resolved_split = {"projects": data.content_split.projects, "experience": data.content_split.experience}
    else:
        default = manifest.default_content_split
        resolved_split = {"projects": default.projects, "experience": default.experience}

    if len(data.experiences) < resolved_split["experience"] or len(data.projects) < resolved_split["projects"]:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Insufficient profile entries. This focus needs {resolved_split['experience']} experiences "
                f"and {resolved_split['projects']} projects."
            ),
        )

    guest_user = await _guest_user(db)
    snapshot = jsonable_encoder(
        {
            "profile": data.profile,
            "experiences": data.experiences,
            "projects": data.projects,
            "education": data.education,
            "extracurriculars": data.extracurriculars,
        }
    )
    gen = Generation(
        user_id=guest_user.id,
        template_id=data.template_id,
        job_description=data.job_description,
        keywords=data.keywords,
        instructions=data.instructions,
        model_used=data.model_used,
        status="pending",
        content_split=resolved_split,
        is_guest=True,
        guest_token_hash=token_hash,
        guest_input_snapshot=snapshot,
        expires_at=datetime.now(timezone.utc) + timedelta(days=GUEST_ARTIFACT_DAYS),
    )
    db.add(gen)
    await db.commit()
    await db.refresh(gen)

    try:
        await trigger_pipeline(str(gen.id))
    except Exception as e:
        gen.status = "failed"
        gen.error_message = f"Failed to start pipeline: {e}"
        await db.commit()
        await db.refresh(gen)
        raise HTTPException(status_code=502, detail=f"Failed to start pipeline: {e}")
    return _out(gen)


@router.get("/generate/{gen_id}", response_model=GuestGenerationOut)
async def get_guest_generation(
    gen_id: str,
    resumer_guest_token: str | None = Cookie(default=None, alias=GUEST_COOKIE),
    db: AsyncSession = Depends(get_db),
):
    if not resumer_guest_token:
        raise HTTPException(status_code=401, detail="Guest session missing")
    return _out(await _guest_generation(gen_id, _hash_token(resumer_guest_token), db))


@router.get("/generate/{gen_id}/logs")
async def get_guest_logs(
    gen_id: str,
    since: int = 0,
    resumer_guest_token: str | None = Cookie(default=None, alias=GUEST_COOKIE),
    db: AsyncSession = Depends(get_db),
):
    if not resumer_guest_token:
        raise HTTPException(status_code=401, detail="Guest session missing")
    gen = await _guest_generation(gen_id, _hash_token(resumer_guest_token), db)
    result = await db.execute(
        select(GenerationLog)
        .where(GenerationLog.generation_id == gen.id, GenerationLog.id > since)
        .order_by(GenerationLog.id)
    )
    logs = [
        {
            "id": log.id,
            "node": log.node_name,
            "message": log.message,
            "level": log.level,
            "timestamp": log.timestamp.isoformat() if log.timestamp else None,
        }
        for log in result.scalars().all()
    ]
    return {"logs": logs, "status": gen.status}


@router.get("/generate/{gen_id}/preview")
async def preview_guest_generation(
    gen_id: str,
    resumer_guest_token: str | None = Cookie(default=None, alias=GUEST_COOKIE),
    db: AsyncSession = Depends(get_db),
):
    if not resumer_guest_token:
        raise HTTPException(status_code=401, detail="Guest session missing")
    gen = await _guest_generation(gen_id, _hash_token(resumer_guest_token), db)
    if gen.status != "completed":
        raise HTTPException(status_code=400, detail="Generation is not completed yet.")

    storage = StorageService()
    if storage.enabled and gen.pdf_storage_key and storage.file_exists(gen.pdf_storage_key):
        presigned_url = storage.get_presigned_url(gen.pdf_storage_key)
        if presigned_url:
            return RedirectResponse(presigned_url)

    metadata = gen.render_metadata or {}
    tailored_resume = metadata.get("tailored_resume")
    font_size = metadata.get("font_size")
    snapshot = gen.guest_input_snapshot or {}
    profile = snapshot.get("profile") or {}
    if not tailored_resume:
        raise HTTPException(status_code=404, detail="Resume data missing from generation record.")

    template_manifest = TemplateRegistryService.get_template_manifest(gen.template_id)
    if not template_manifest:
        raise HTTPException(status_code=500, detail="Template files missing.")

    html_rendered = TemplateRegistryService.render_template(
        gen.template_id,
        {
            "profile": profile,
            "resume": tailored_resume,
            "font_size": font_size or template_manifest.max_font_size,
            "page_margin_mm": template_manifest.page_margin_mm,
        },
    )
    if not html_rendered:
        raise HTTPException(status_code=500, detail="Template rendering failed.")

    try:
        from weasyprint import HTML
    except (OSError, ImportError) as e:
        raise HTTPException(status_code=500, detail=f"PDF rendering is not configured on this host: {e}")

    from src.core.config import settings

    pdf_bytes = HTML(string=html_rendered, base_url=str(settings.TEMPLATES_DIR / gen.template_id)).write_pdf()
    return Response(content=pdf_bytes, media_type="application/pdf")
