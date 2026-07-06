import asyncio
import json
import uuid
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, func, delete, desc, or_
from sqlalchemy.ext.asyncio import AsyncSession
from langchain_core.prompts import ChatPromptTemplate

from src.core.auth import get_current_admin
from src.core.config import settings
from src.core.database import AsyncSessionLocal, get_db
from src.core.executor import trigger_pipeline
from src.core.storage import StorageService
from src.models.generation import (
    Generation,
    GenerationLog,
    GenerationNodeMetric,
    PromptConfig,
    PromptTestRun,
    UserCreditOverride,
    UserRateLimit,
)
from src.models.user import User
from src.pipeline.nodes import invoke_with_fallback
from src.template_registry.service import TemplateRegistryService

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


class CreditOverrideUpdate(BaseModel):
    daily_cap: int | None = None
    monthly_cap: int | None = None
    admin_note: str | None = None


class PromptPlaygroundRequest(BaseModel):
    prompt_name: str
    system_prompt: str
    user_prompt: str | None = None
    variables: dict[str, Any] = {}


class PromptBulkTestRequest(BaseModel):
    prompt_name: str
    system_prompt: str
    user_prompt: str | None = None
    cases: list[dict[str, Any]]


class StorageKeyRequest(BaseModel):
    key: str


class OrphanDeleteRequest(BaseModel):
    confirm: str
    prefix: str = ""


class TemplateSandboxRequest(BaseModel):
    template_id: str
    context: dict[str, Any]


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


def _message_content_to_text(content: Any) -> str:
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict) and part.get("type") == "text":
                parts.append(part.get("text", ""))
        return "".join(parts).strip()
    return str(content).strip()


async def _run_prompt_test(data: PromptPlaygroundRequest) -> tuple[str | None, float | None, str | None]:
    prompt = ChatPromptTemplate.from_messages(
        [("system", data.system_prompt), ("user", data.user_prompt or "")]
    )
    started = time.perf_counter()
    try:
        response = await invoke_with_fallback(
            lambda llm, provider: prompt | llm,
            data.variables,
            timeout=120.0,
        )
        latency_ms = (time.perf_counter() - started) * 1000
        return _message_content_to_text(response.content), latency_ms, None
    except Exception as exc:
        return None, (time.perf_counter() - started) * 1000, str(exc)


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

    metrics_result = await db.execute(
        select(
            func.coalesce(func.sum(GenerationNodeMetric.total_tokens), 0),
            func.avg(GenerationNodeMetric.latency_ms),
            func.count().filter(GenerationNodeMetric.fallback_used == True),
            func.count().filter(GenerationNodeMetric.parse_error == True),
            func.count(GenerationNodeMetric.id),
        )
    )
    total_tokens, avg_node_latency, fallback_count, parse_error_count, metric_count = metrics_result.one()

    return {
        "total_users": total_users,
        "total_generations": total_generations,
        "generations_by_status": generations_by_status,
        "total_guest_generations": total_guest_generations,
        "average_generation_latency_seconds": round(avg_latency, 2),
        "failure_rate_percent": round(failure_rate, 2),
        "keys_status": keys_status,
        "llm_metrics": {
            "total_tokens": int(total_tokens or 0),
            "average_node_latency_ms": round(avg_node_latency or 0, 2),
            "fallback_count": fallback_count or 0,
            "parse_error_count": parse_error_count or 0,
            "recorded_calls": metric_count or 0,
        },
    }


@router.get("/metrics/summary", dependencies=[Depends(get_current_admin)])
async def metrics_summary(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(
            func.coalesce(func.sum(GenerationNodeMetric.total_tokens), 0),
            func.avg(GenerationNodeMetric.latency_ms),
            func.count().filter(GenerationNodeMetric.fallback_used == True),
            func.count().filter(GenerationNodeMetric.parse_error == True),
            func.count(GenerationNodeMetric.id),
        )
    )
    total_tokens, avg_latency, fallback_count, parse_error_count, total_calls = result.one()
    return {
        "total_tokens": int(total_tokens or 0),
        "average_node_latency_ms": round(avg_latency or 0, 2),
        "fallback_count": fallback_count or 0,
        "parse_error_count": parse_error_count or 0,
        "recorded_calls": total_calls or 0,
    }


@router.get("/metrics/nodes", dependencies=[Depends(get_current_admin)])
async def metrics_by_node(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(
            GenerationNodeMetric.node_name,
            GenerationNodeMetric.provider,
            func.count(GenerationNodeMetric.id),
            func.avg(GenerationNodeMetric.latency_ms),
            func.count().filter(GenerationNodeMetric.status == "error"),
            func.count().filter(GenerationNodeMetric.fallback_used == True),
            func.count().filter(GenerationNodeMetric.parse_error == True),
            func.coalesce(func.sum(GenerationNodeMetric.total_tokens), 0),
        )
        .group_by(GenerationNodeMetric.node_name, GenerationNodeMetric.provider)
        .order_by(GenerationNodeMetric.node_name, GenerationNodeMetric.provider)
    )
    return [
        {
            "node_name": row[0],
            "provider": row[1],
            "calls": row[2],
            "average_latency_ms": round(row[3] or 0, 2),
            "errors": row[4],
            "fallbacks": row[5],
            "parse_errors": row[6],
            "total_tokens": int(row[7] or 0),
        }
        for row in result.all()
    ]


@router.get("/generations/{id}/metrics", dependencies=[Depends(get_current_admin)])
async def generation_metrics(id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(GenerationNodeMetric)
        .where(GenerationNodeMetric.generation_id == id)
        .order_by(GenerationNodeMetric.created_at, GenerationNodeMetric.id)
    )
    return [
        {
            "id": metric.id,
            "node_name": metric.node_name,
            "provider": metric.provider,
            "model": metric.model,
            "status": metric.status,
            "latency_ms": metric.latency_ms,
            "fallback_used": metric.fallback_used,
            "parse_error": metric.parse_error,
            "error_message": metric.error_message,
            "prompt_tokens": metric.prompt_tokens,
            "completion_tokens": metric.completion_tokens,
            "total_tokens": metric.total_tokens,
            "created_at": metric.created_at,
        }
        for metric in result.scalars().all()
    ]


@router.get("/storage/objects", dependencies=[Depends(get_current_admin)])
async def list_storage_objects(prefix: str = "", cursor: str | None = None, limit: int = 100):
    storage = StorageService()
    return storage.list_objects(prefix=prefix, cursor=cursor, limit=limit)


@router.get("/storage/object", dependencies=[Depends(get_current_admin)])
async def get_storage_object(key: str):
    storage = StorageService()
    metadata = storage.get_object_metadata(key)
    if not metadata:
        raise HTTPException(status_code=404, detail="Object not found or storage disabled")
    metadata["download_url"] = storage.get_presigned_url(key, response_content_disposition=f'attachment; filename="{key.split("/")[-1]}"')
    return metadata


@router.delete("/storage/object", dependencies=[Depends(get_current_admin)])
async def delete_storage_object(data: StorageKeyRequest):
    if not data.key:
        raise HTTPException(status_code=422, detail="key required")
    deleted = StorageService().delete_file(data.key)
    if not deleted:
        raise HTTPException(status_code=404, detail="Object not deleted")
    return {"status": "success"}


async def _referenced_storage_keys(db: AsyncSession) -> set[str]:
    result = await db.execute(select(Generation.pdf_storage_key, Generation.md_storage_key, Generation.thumb_storage_key))
    keys: set[str] = set()
    for pdf_key, md_key, thumb_key in result.all():
        keys.update(k for k in [pdf_key, md_key, thumb_key] if k)
    return keys


@router.get("/storage/orphans/dry-run", dependencies=[Depends(get_current_admin)])
async def storage_orphans_dry_run(prefix: str = "", db: AsyncSession = Depends(get_db)):
    storage = StorageService()
    listed = storage.list_objects(prefix=prefix, limit=1000)
    objects = listed.get("objects", [])
    referenced = await _referenced_storage_keys(db)
    object_keys = {obj["key"] for obj in objects}
    orphan_objects = [obj for obj in objects if obj["key"] not in referenced]
    missing_db_keys = sorted(k for k in referenced if k.startswith(prefix) and k not in object_keys)
    return {
        "orphan_objects": orphan_objects,
        "missing_db_keys": missing_db_keys,
        "orphan_count": len(orphan_objects),
        "orphan_bytes": sum(obj.get("size", 0) for obj in orphan_objects),
        "truncated": bool(listed.get("next_cursor")),
    }


@router.delete("/storage/orphans", dependencies=[Depends(get_current_admin)])
async def delete_storage_orphans(data: OrphanDeleteRequest, db: AsyncSession = Depends(get_db)):
    if data.confirm != "DELETE ORPHANS":
        raise HTTPException(status_code=422, detail="confirm must equal DELETE ORPHANS")
    dry_run = await storage_orphans_dry_run(prefix=data.prefix, db=db)
    storage = StorageService()
    deleted = []
    for obj in dry_run["orphan_objects"]:
        if storage.delete_file(obj["key"]):
            deleted.append(obj["key"])
    return {"status": "success", "deleted": deleted}


@router.post("/templates/sandbox/render", dependencies=[Depends(get_current_admin)])
async def render_template_sandbox(data: TemplateSandboxRequest):
    manifest = TemplateRegistryService.get_template_manifest(data.template_id)
    if not manifest:
        raise HTTPException(status_code=404, detail="Template not found")
    html = TemplateRegistryService.render_template(data.template_id, data.context)
    if html is None:
        raise HTTPException(status_code=422, detail="Template render failed")
    return {"template_id": data.template_id, "html": html, "manifest": manifest.model_dump()}


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
    limit: int = 50,
    offset: int = 0,
    status_filter: str | None = None,
    search: str | None = None,
    user_type: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(Generation, User.email)
        .outerjoin(User, Generation.user_id == User.id)
    )

    if status_filter:
        query = query.where(Generation.status == status_filter)

    if user_type == "guest":
        query = query.where(Generation.is_guest == True)
    elif user_type == "user":
        query = query.where(Generation.is_guest == False)

    if search:
        like = f"%{search.strip()}%"
        query = query.where(
            or_(
                Generation.job_title.ilike(like),
                Generation.company.ilike(like),
                Generation.model_used.ilike(like),
                User.email.ilike(like),
            )
        )

    query = query.order_by(desc(Generation.created_at)).offset(offset).limit(limit)
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


@router.get("/generations/{id}/stream", dependencies=[Depends(get_current_admin)])
async def stream_generation_logs(id: uuid.UUID):
    async def event_stream():
        last_id = 0
        while True:
            async with AsyncSessionLocal() as db:
                gen_res = await db.execute(select(Generation).where(Generation.id == id))
                gen = gen_res.scalar_one_or_none()
                if not gen:
                    yield "event: error\ndata: {\"detail\":\"Generation not found\"}\n\n"
                    return
                logs_res = await db.execute(
                    select(GenerationLog)
                    .where(GenerationLog.generation_id == id, GenerationLog.id > last_id)
                    .order_by(GenerationLog.id)
                )
                for log in logs_res.scalars().all():
                    last_id = log.id
                    payload = {
                        "id": log.id,
                        "timestamp": log.timestamp.isoformat(),
                        "level": log.level,
                        "message": log.message,
                        "node_name": log.node_name,
                    }
                    yield f"event: log\ndata: {json.dumps(payload)}\n\n"
                if gen.status in {"completed", "failed"}:
                    yield f"event: done\ndata: {json.dumps({'status': gen.status})}\n\n"
                    return
            await asyncio.sleep(1)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


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
async def list_users(
    limit: int = 50,
    offset: int = 0,
    search: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(User, UserRateLimit.request_count, UserRateLimit.reset_at)
        .outerjoin(UserRateLimit, User.id == UserRateLimit.user_id)
    )
    if search:
        like = f"%{search.strip()}%"
        query = query.where(or_(User.email.ilike(like), User.name.ilike(like)))

    query = query.order_by(User.created_at.desc()).offset(offset).limit(limit)
    result = await db.execute(query)
    output = []
    for row in result.all():
        u = row[0]
        req_count = row[1] or 0
        reset_at = row[2]
        override_result = await db.execute(
            select(UserCreditOverride).where(UserCreditOverride.user_id == u.id)
        )
        override = override_result.scalar_one_or_none()
        month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        monthly_result = await db.execute(
            select(func.count(Generation.id)).where(
                Generation.user_id == u.id,
                Generation.created_at >= month_start,
            )
        )
        monthly_count = monthly_result.scalar() or 0
        output.append(
            {
                "id": u.id,
                "email": u.email,
                "name": u.name,
                "created_at": u.created_at,
                "provider": u.provider,
                "request_count": req_count,
                "reset_at": reset_at,
                "daily_cap": override.daily_cap if override and override.daily_cap is not None else settings.DEFAULT_DAILY_CAP,
                "monthly_cap": override.monthly_cap if override and override.monthly_cap is not None else settings.DEFAULT_MONTHLY_CAP,
                "monthly_count": monthly_count,
                "admin_note": override.admin_note if override else None,
            }
        )
    return output


@router.get("/users/{id}/credits", dependencies=[Depends(get_current_admin)])
async def get_user_credits(id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    user_result = await db.execute(select(User).where(User.id == id))
    if not user_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="User not found")

    limit_result = await db.execute(select(UserRateLimit).where(UserRateLimit.user_id == id))
    limit = limit_result.scalar_one_or_none()
    override_result = await db.execute(select(UserCreditOverride).where(UserCreditOverride.user_id == id))
    override = override_result.scalar_one_or_none()
    month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    monthly_result = await db.execute(
        select(func.count(Generation.id)).where(Generation.user_id == id, Generation.created_at >= month_start)
    )
    return {
        "user_id": id,
        "request_count": limit.request_count if limit else 0,
        "reset_at": limit.reset_at if limit else None,
        "daily_cap": override.daily_cap if override and override.daily_cap is not None else settings.DEFAULT_DAILY_CAP,
        "monthly_cap": override.monthly_cap if override and override.monthly_cap is not None else settings.DEFAULT_MONTHLY_CAP,
        "monthly_count": monthly_result.scalar() or 0,
        "admin_note": override.admin_note if override else None,
    }


@router.put("/users/{id}/credits", dependencies=[Depends(get_current_admin)])
async def update_user_credits(id: uuid.UUID, data: CreditOverrideUpdate, db: AsyncSession = Depends(get_db)):
    user_result = await db.execute(select(User).where(User.id == id))
    if not user_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="User not found")

    override_result = await db.execute(select(UserCreditOverride).where(UserCreditOverride.user_id == id))
    override = override_result.scalar_one_or_none()
    if not override:
        override = UserCreditOverride(user_id=id)
        db.add(override)
    override.daily_cap = data.daily_cap
    override.monthly_cap = data.monthly_cap
    override.admin_note = data.admin_note
    await db.commit()
    return {"status": "success"}


@router.post("/users/{id}/credits/reset", dependencies=[Depends(get_current_admin)])
async def reset_user_daily_usage(id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(UserRateLimit).where(UserRateLimit.user_id == id))
    limit = result.scalar_one_or_none()
    if limit:
        limit.request_count = 0
        limit.reset_at = datetime.now(timezone.utc)
        await db.commit()
    return {"status": "success"}


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


@router.post("/prompts/playground", dependencies=[Depends(get_current_admin)])
async def run_prompt_playground(
    data: PromptPlaygroundRequest,
    admin_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    output, latency_ms, error = await _run_prompt_test(data)
    run = PromptTestRun(
        admin_user_id=admin_user.id,
        prompt_name=data.prompt_name,
        system_prompt=data.system_prompt,
        user_prompt=data.user_prompt,
        variables=data.variables,
        output=output,
        status="failed" if error else "completed",
        latency_ms=latency_ms,
        error_message=error,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    return {
        "id": run.id,
        "status": run.status,
        "output": run.output,
        "latency_ms": run.latency_ms,
        "error_message": run.error_message,
        "created_at": run.created_at,
    }


@router.post("/prompts/bulk-test", dependencies=[Depends(get_current_admin)])
async def run_prompt_bulk_test(
    data: PromptBulkTestRequest,
    admin_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    if len(data.cases) > 20:
        raise HTTPException(status_code=422, detail="Bulk test max is 20 cases")

    results = []
    for variables in data.cases:
        request = PromptPlaygroundRequest(
            prompt_name=data.prompt_name,
            system_prompt=data.system_prompt,
            user_prompt=data.user_prompt,
            variables=variables,
        )
        output, latency_ms, error = await _run_prompt_test(request)
        run = PromptTestRun(
            admin_user_id=admin_user.id,
            prompt_name=data.prompt_name,
            system_prompt=data.system_prompt,
            user_prompt=data.user_prompt,
            variables=variables,
            output=output,
            status="failed" if error else "completed",
            latency_ms=latency_ms,
            error_message=error,
        )
        db.add(run)
        await db.flush()
        results.append(
            {
                "id": run.id,
                "status": run.status,
                "output": run.output,
                "latency_ms": run.latency_ms,
                "error_message": run.error_message,
            }
        )
    await db.commit()
    return {"results": results}


@router.get("/prompts/test-runs", dependencies=[Depends(get_current_admin)])
async def list_prompt_test_runs(limit: int = 50, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PromptTestRun).order_by(desc(PromptTestRun.created_at)).limit(limit)
    )
    return [
        {
            "id": run.id,
            "prompt_name": run.prompt_name,
            "variables": run.variables,
            "output": run.output,
            "status": run.status,
            "latency_ms": run.latency_ms,
            "error_message": run.error_message,
            "created_at": run.created_at,
        }
        for run in result.scalars().all()
    ]
