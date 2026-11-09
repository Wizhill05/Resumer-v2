import asyncio
import hashlib
import hmac
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.analytics import capture_generation
from src.core.client_ip import trusted_client_ip
from src.core.config import settings
from src.core.database import get_db
from src.core.executor import trigger_pipeline
from src.core.storage import StorageService
from src.models.generation import Generation, GenerationLog
from src.models.user import User
from src.schemas.guest import GuestGenerationCreate, GuestGenerationOut
from src.schemas.template import DEFAULT_SECTION_ORDER
from src.services.rate_limit import check_rate_limit
from src.services.resume_import import MAX_FILES, extract_resume_draft, extract_upload_text, merge_drafts
from src.services.support import verify_turnstile
from src.services.template_layout import get_generation_section_order
from src.template_registry.service import TemplateRegistryService
from src.services.import_jobs import import_jobs

router = APIRouter(prefix="/guest", tags=["guest"])

GUEST_COOKIE = "resumer_guest_token"
GUEST_USER_EMAIL = "__guest__@resumer.local"
GUEST_MAX_DAILY_RUNS = 5
GUEST_TOKEN_DAYS = 7
GUEST_ARTIFACT_DAYS = 7


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _set_guest_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        GUEST_COOKIE,
        token,
        max_age=GUEST_TOKEN_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=True,
        samesite="lax",
    )


def _guest_token(response: Response, token: str | None) -> str:
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


async def guest_quota(token_hash: str | None, db: AsyncSession) -> dict:
    limit = GUEST_MAX_DAILY_RUNS
    if not token_hash:
        return {"limit": limit, "used": 0, "remaining": limit, "resets_at": None}
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(hours=24)
    stmt = (
        select(Generation.created_at)
        .where(
            Generation.is_guest == True,  # noqa: E712
            Generation.guest_token_hash == token_hash,
            Generation.created_at > window_start,
            Generation.status != "failed",
        )
        .order_by(Generation.created_at.asc())
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()
    used = len(rows)
    if used >= 1:
        oldest = rows[0]
        # Normalize naive timestamps (SQLite in tests) to UTC aware
        if isinstance(oldest, datetime) and oldest.tzinfo is None:
            oldest = oldest.replace(tzinfo=timezone.utc)
        resets_at = (oldest + timedelta(hours=24)).isoformat() if isinstance(oldest, datetime) else None
    else:
        resets_at = None
    remaining = max(0, limit - used)
    return {"limit": limit, "used": used, "remaining": remaining, "resets_at": resets_at}


def _dialect_name(db: AsyncSession) -> str:
    try:
        return db.get_bind().dialect.name
    except Exception:
        return getattr(getattr(getattr(db, "bind", None), "dialect", None), "name", "postgresql")


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
        creativity_mode=getattr(gen, "creativity_mode", None) or "proper",
        error_message=gen.error_message,
        section_order=gen.section_order,
        expires_at=gen.expires_at.isoformat() if gen.expires_at else None,
    )


async def _verify_guest_turnstile(token: str | None, client_ip: str | None) -> None:
    """Guest Turnstile gate. Only enforced when required and a secret is set."""
    if not settings.GUEST_TURNSTILE_REQUIRED:
        return
    if not settings.TURNSTILE_SECRET_KEY:
        return
    try:
        await verify_turnstile(token, client_ip)
    except HTTPException:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "turnstile_failed", "message": "Please complete the security check and try again."},
        )


async def run_guest_import_task(job_id: str, texts: list[str], filenames: list[str]):
    try:
        import_jobs[job_id]["status"] = "extracting"
        tasks = [extract_resume_draft(text, filename) for text, filename in zip(texts, filenames)]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        drafts = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                print(f"[guest/import/task] skipping {filenames[i]}: {result}")
                if len(texts) == 1:
                    raise result
            else:
                drafts.append(result)

        if not drafts:
            raise Exception("Could not extract data from any of the uploaded resumes.")

        import_jobs[job_id]["status"] = "deduplicating"
        await asyncio.sleep(1.0)  # Visual separation of stage for UI

        merged = merge_drafts(drafts)
        import_jobs[job_id]["result"] = jsonable_encoder(merged)
        import_jobs[job_id]["status"] = "completed"
    except Exception as e:
        import_jobs[job_id]["error"] = str(e)
        import_jobs[job_id]["status"] = "failed"


@router.post("/import/start")
async def start_guest_import(
    request: Request,
    background_tasks: BackgroundTasks,
    response: Response,
    files: list[UploadFile] = File(...),
    turnstile_token: str | None = Form(default=None),
    resumer_guest_token: str | None = Cookie(default=None, alias=GUEST_COOKIE),
    db: AsyncSession = Depends(get_db),
):
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"Upload {MAX_FILES} resumes or fewer")

    client_ip = trusted_client_ip(request)
    await _verify_guest_turnstile(turnstile_token, client_ip)

    token = _guest_token(response, resumer_guest_token)
    token_hash = _hash_token(token)

    # Per-token import limit (cookieless clients get a fresh token each time,
    # so the per-IP limit below is what actually stops them).
    await check_rate_limit(
        db,
        f"guest-token:{token_hash}:import",
        settings.GUEST_IMPORT_DAILY_PER_TOKEN,
        timedelta(hours=24),
        {"code": "guest_import_limit", "message": "Too many free imports today. Sign in to keep going, or try again tomorrow."},
    )
    # Per-IP import limit. Skipped when no trusted IP is available.
    if client_ip:
        await check_rate_limit(
            db,
            f"guest-ip:{client_ip}:import",
            settings.GUEST_IMPORT_DAILY_PER_IP,
            timedelta(hours=24),
            {"code": "guest_ip_limit", "message": "Too many free imports from this network today. Sign in to keep going, or try again tomorrow."},
        )

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
        "token_hash": token_hash,
    }

    background_tasks.add_task(run_guest_import_task, job_id, texts, filenames)
    return {"job_id": job_id}


@router.get("/import/status/{job_id}")
async def get_guest_import_status(
    job_id: str,
    resumer_guest_token: str | None = Cookie(default=None, alias=GUEST_COOKIE),
):
    if not resumer_guest_token:
        raise HTTPException(status_code=404, detail="Import job not found")
    if job_id not in import_jobs:
        raise HTTPException(status_code=404, detail="Import job not found")
    job = import_jobs[job_id]
    expected = job.get("token_hash")
    if not expected or not hmac.compare_digest(expected, _hash_token(resumer_guest_token)):
        raise HTTPException(status_code=404, detail="Import job not found")
    return {key: value for key, value in job.items() if key != "token_hash"}


@router.get("/quota")
async def get_guest_quota_endpoint(
    resumer_guest_token: str | None = Cookie(default=None, alias=GUEST_COOKIE),
    db: AsyncSession = Depends(get_db),
):
    token_hash = _hash_token(resumer_guest_token) if resumer_guest_token else None
    return await guest_quota(token_hash, db)


@router.post("/generate", response_model=GuestGenerationOut)
async def start_guest_generation(
    request: Request,
    data: GuestGenerationCreate,
    response: Response,
    resumer_guest_token: str | None = Cookie(default=None, alias=GUEST_COOKIE),
    db: AsyncSession = Depends(get_db),
):
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

    from src.services.readiness import usable_experiences, usable_projects

    if (len(usable_experiences(data.experiences)) < resolved_split["experience"]
            or len(usable_projects(data.projects)) < resolved_split["projects"]):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Insufficient usable profile entries. This focus needs {resolved_split['experience']} experiences "
                f"and {resolved_split['projects']} projects."
            ),
        )

    client_ip = trusted_client_ip(request)
    await _verify_guest_turnstile(data.turnstile_token, client_ip)

    token = _guest_token(response, resumer_guest_token)
    token_hash = _hash_token(token)

    # Global daily cap across all guest tokens.
    cap = settings.GUEST_DAILY_GLOBAL_CAP
    if cap and cap > 0:
        now = datetime.now(timezone.utc)
        window_start = now - timedelta(hours=24)
        total = (
            await db.execute(
                select(func.count(Generation.id)).where(
                    Generation.is_guest == True,  # noqa: E712
                    Generation.created_at > window_start,
                    Generation.status != "failed",
                )
            )
        ).scalar() or 0
        if total >= cap:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={"code": "guest_trial_busy", "message": "The free trial is busy today. Sign in to keep going."},
            )

    # Per-IP daily limit. Skipped when no trusted IP is available (direct
    # backend hit or missing INTERNAL_API_SECRET), since the IP would not be
    # trustworthy anyway.
    if client_ip:
        await check_rate_limit(
            db,
            f"guest-ip:{client_ip}:generate",
            settings.GUEST_GENERATE_DAILY_PER_IP,
            timedelta(hours=24),
            {"code": "guest_ip_limit", "message": "Too many free résumés from this network today. Sign in to keep going, or try again tomorrow."},
        )

    guest_user = await _guest_user(db)

    if _dialect_name(db) == "postgresql":
        await db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:token_hash, 0))"), {"token_hash": token_hash})

    quota = await guest_quota(token_hash, db)
    if quota["remaining"] <= 0:
        # Use get() for safety though quota always contains these keys
        resets_at = quota.get("resets_at")
        limit = quota.get("limit", GUEST_MAX_DAILY_RUNS)
        try:
            await db.rollback()
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "guest_quota_exhausted",
                "message": f"You've used all {limit} free résumés for today. Sign in to keep going, or come back later.",
                "resets_at": resets_at,
                "limit": limit,
            },
        )
    snapshot = jsonable_encoder(
        {
            "profile": data.profile,
            "experiences": data.experiences,
            "projects": data.projects,
            "education": data.education,
            "extracurriculars": data.extracurriculars,
        }
    )
    guest_section_order = list(
        manifest.default_section_order
        if manifest.default_section_order
        else DEFAULT_SECTION_ORDER
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
        section_order=guest_section_order,
        is_guest=True,
        creativity_mode=data.creativity_mode or "proper",
        guest_token_hash=token_hash,
        guest_input_snapshot=snapshot,
        render_metadata={"_analytics": data.analytics_context.model_dump() if data.analytics_context else None},
        expires_at=datetime.now(timezone.utc) + timedelta(days=GUEST_ARTIFACT_DAYS),
    )
    db.add(gen)
    await db.commit()
    await db.refresh(gen)

    capture_generation(gen, "accepted")
    try:
        await trigger_pipeline(str(gen.id))
    except Exception as e:
        gen.status = "failed"
        gen.completed_at = datetime.now(timezone.utc)
        gen.error_message = f"Failed to start pipeline: {e}"
        await db.commit()
        await db.refresh(gen)
        capture_generation(gen, "failed")
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
            "section_order": get_generation_section_order(
                gen.section_order, gen.template_id
            ),
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
