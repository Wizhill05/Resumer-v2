import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, func, delete, desc
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.auth import get_current_admin
from src.core.config import settings
from src.core.database import get_db
from src.core.executor import trigger_pipeline
from src.core.storage import StorageService
from src.models.generation import Generation, GenerationLog, UserRateLimit, PromptConfig
from src.models.user import User

router = APIRouter(prefix="/admin", tags=["admin"])


# ── Schemas ───────────────────────────────────────────────────────────────────


class PromptConfigSchema(BaseModel):
    name: str
    system_prompt: str
    user_prompt: str | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class RateLimitUpdate(BaseModel):
    request_count: int


class AdminGenerationOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    email: str | None = None
    template_id: str
    job_title: str | None
    company: str | None
    model_used: str
    status: str
    created_at: datetime
    completed_at: datetime | None = None
    is_guest: bool
    error_message: str | None = None


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("/analytics", dependencies=[Depends(get_current_admin)])
async def get_analytics(db: AsyncSession = Depends(get_db)):
    # 1. Total User Count
    user_count_result = await db.execute(select(func.count(User.id)))
    total_users = user_count_result.scalar() or 0

    # 2. Generations Count by Status
    gen_by_status_query = select(Generation.status, func.count(Generation.id)).group_by(Generation.status)
    gen_by_status_result = await db.execute(gen_by_status_query)
    generations_by_status = {status: count for status, count in gen_by_status_result.all()}

    total_generations = sum(generations_by_status.values())

    # 3. Guest Generations
    guest_gen_result = await db.execute(
        select(func.count(Generation.id)).where(Generation.is_guest == True)
    )
    total_guest_generations = guest_gen_result.scalar() or 0

    # 4. Latency Analysis (Average run time in seconds for completed generations)
    latency_query = select(
        func.avg(
            func.extract("epoch", Generation.completed_at) - func.extract("epoch", Generation.created_at)
        )
    ).where(Generation.status == "completed", Generation.completed_at.isnot(None))
    avg_latency_res = await db.execute(latency_query)
    avg_latency = avg_latency_res.scalar() or 0.0

    # 5. Fallback/Error rates
    failed_count = generations_by_status.get("failed", 0)
    failure_rate = (failed_count / total_generations * 100) if total_generations > 0 else 0.0

    # 6. Keys status (round robin count). Import lazily so admin route import
    # does not crash before app startup validation can produce a clear error.
    try:
        from src.core.api_key_pool import cerebras_pool, google_pool

        cerebras_key_count = cerebras_pool.count
        google_key_count = google_pool.count
    except RuntimeError:
        cerebras_key_count = len(settings.cerebras_api_keys)
        google_key_count = len(settings.google_api_keys)

    keys_status = {
        "cerebras": {
            "configured_keys_count": cerebras_key_count,
        },
        "google": {
            "configured_keys_count": google_key_count,
        },
    }

    return {
        "total_users": total_users,
        "total_generations": total_generations,
        "generations_by_status": generations_by_status,
        "total_guest_generations": total_guest_generations,
        "average_generation_latency_seconds": round(avg_latency, 2),
        "failure_rate_percent": round(failure_rate, 2),
        "keys_status": keys_status,
    }


@router.get("/prompts", response_model=list[PromptConfigSchema], dependencies=[Depends(get_current_admin)])
async def list_prompts(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PromptConfig))
    return result.scalars().all()


@router.put("/prompts/{name}", response_model=PromptConfigSchema, dependencies=[Depends(get_current_admin)])
async def update_prompt(name: str, data: PromptConfigSchema, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PromptConfig).where(PromptConfig.name == name))
    cfg = result.scalar_one_or_none()
    if not cfg:
        cfg = PromptConfig(name=name)
        db.add(cfg)

    cfg.system_prompt = data.system_prompt
    cfg.user_prompt = data.user_prompt
    cfg.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(cfg)
    return cfg


@router.get("/generations", response_model=list[AdminGenerationOut], dependencies=[Depends(get_current_admin)])
async def list_all_generations(
    limit: int = 50, offset: int = 0, db: AsyncSession = Depends(get_db)
):
    query = (
        select(Generation, User.email)
        .outerjoin(User, Generation.user_id == User.id)
        .order_by(desc(Generation.created_at))
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(query)
    output = []
    for row in result.all():
        gen = row[0]
        email = row[1]
        output.append(
            AdminGenerationOut(
                id=gen.id,
                user_id=gen.user_id,
                email=email,
                template_id=gen.template_id,
                job_title=gen.job_title,
                company=gen.company,
                model_used=gen.model_used,
                status=gen.status,
                created_at=gen.created_at,
                completed_at=gen.completed_at,
                is_guest=gen.is_guest,
                error_message=gen.error_message,
            )
        )
    return output


@router.delete("/generations/{id}", dependencies=[Depends(get_current_admin)])
async def delete_generation(id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    gen_res = await db.execute(select(Generation).where(Generation.id == id))
    gen = gen_res.scalar_one_or_none()
    if not gen:
        raise HTTPException(status_code=404, detail="Generation not found")

    # Clean up storage first
    storage = StorageService()
    if gen.pdf_storage_key:
        storage.delete_file(gen.pdf_storage_key)
    if gen.md_storage_key:
        storage.delete_file(gen.md_storage_key)
    if gen.thumb_storage_key:
        storage.delete_file(gen.thumb_storage_key)

    await db.execute(delete(Generation).where(Generation.id == id))
    await db.commit()
    return {"status": "success", "message": f"Generation {id} deleted successfully"}


@router.get("/generations/{id}/logs", dependencies=[Depends(get_current_admin)])
async def get_generation_logs(id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    logs_res = await db.execute(
        select(GenerationLog)
        .where(GenerationLog.generation_id == id)
        .order_by(GenerationLog.timestamp)
    )
    logs = logs_res.scalars().all()
    return [
        {
            "id": l.id,
            "timestamp": l.timestamp,
            "level": l.level,
            "message": l.message,
            "node_name": l.node_name,
        }
        for l in logs
    ]


@router.post("/generations/{id}/retry", dependencies=[Depends(get_current_admin)])
async def retry_generation(id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    gen_res = await db.execute(select(Generation).where(Generation.id == id))
    gen = gen_res.scalar_one_or_none()
    if not gen:
        raise HTTPException(status_code=404, detail="Generation not found")
    if gen.status != "failed":
        raise HTTPException(status_code=409, detail="Only failed generations can be retried")

    storage = StorageService()
    for key in [gen.pdf_storage_key, gen.md_storage_key, gen.thumb_storage_key]:
        if key:
            storage.delete_file(key)

    gen.status = "pending"
    gen.error_message = None
    gen.completed_at = None
    gen.pdf_storage_key = None
    gen.md_storage_key = None
    gen.thumb_storage_key = None
    await db.execute(delete(GenerationLog).where(GenerationLog.generation_id == id))
    await db.commit()

    try:
        await trigger_pipeline(str(gen.id))
    except Exception as e:
        gen.status = "failed"
        gen.error_message = f"Failed to restart pipeline: {e}"
        await db.commit()
        raise HTTPException(status_code=502, detail=f"Failed to start pipeline: {e}")

    return {"status": "success", "message": "Pipeline restarted successfully"}


@router.get("/users", dependencies=[Depends(get_current_admin)])
async def list_users(limit: int = 50, offset: int = 0, db: AsyncSession = Depends(get_db)):
    query = (
        select(User, UserRateLimit.request_count, UserRateLimit.reset_at)
        .outerjoin(UserRateLimit, User.id == UserRateLimit.user_id)
        .order_by(User.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(query)
    output = []
    for row in result.all():
        u = row[0]
        req_count = row[1] or 0
        reset_at = row[2]
        output.append(
            {
                "id": u.id,
                "email": u.email,
                "name": u.name,
                "created_at": u.created_at,
                "provider": u.provider,
                "request_count": req_count,
                "reset_at": reset_at,
            }
        )
    return output


@router.put("/users/{id}/rate-limit", dependencies=[Depends(get_current_admin)])
async def update_user_rate_limit(
    id: uuid.UUID, data: RateLimitUpdate, db: AsyncSession = Depends(get_db)
):
    from datetime import timedelta
    # Upsert the user's rate limit
    result = await db.execute(select(UserRateLimit).where(UserRateLimit.user_id == id))
    limit = result.scalar_one_or_none()
    if not limit:
        limit = UserRateLimit(
            user_id=id,
            request_count=data.request_count,
            reset_at=datetime.now(timezone.utc) + timedelta(hours=24),
        )
        db.add(limit)
    else:
        limit.request_count = data.request_count

    await db.commit()
    return {"status": "success", "message": f"User {id} rate limit updated to {data.request_count}"}
