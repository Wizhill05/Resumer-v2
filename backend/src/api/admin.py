import asyncio
import json
import uuid
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response, StreamingResponse
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
from src.services.llm_config import llm_config_service, TierConfig
from src.template_registry.service import TemplateRegistryService

router = APIRouter(prefix="/admin", tags=["admin"])


# ── Schemas ───────────────────────────────────────────────────────────────────


class ModelSettingsOut(BaseModel):
    tier: str
    provider_name: str
    base_url: str
    model: str
    temperature: float
    fallback_provider: str | None = None
    fallback_model: str | None = None
    extra_headers: dict[str, str] = {}
    is_active: bool = True
    updated_at: datetime | None = None


class ModelSettingsUpdate(BaseModel):
    tier: str  # "free" | "pro"
    base_url: str
    model: str
    temperature: float = 0.2
    provider_name: str | None = None
    fallback_provider: str | None = "google"
    fallback_model: str | None = "gemma-4-31b-it"
    extra_headers: dict[str, str] | None = None


class ModelTestRequest(BaseModel):
    tier: str = "pro"  # "pro" | "free"
    base_url: str | None = None
    model: str | None = None
    prompt: str | None = None


class UserTierUpdate(BaseModel):
    is_pro: bool


def _mask_key(key: str) -> str:
    if not key:
        return ""
    key = key.strip()
    if len(key) <= 8:
        return "****"
    return f"{key[:4]}...{key[-4:]}"


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
    duration_seconds: float | None = None
    is_guest: bool
    error_message: str | None = None
    intermediate_resume_count: int = 0

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

    # 4. Latency Analysis (Average, Percentiles, and Distribution for completed generations)
    durations_query = select(
        func.extract("epoch", Generation.completed_at) - func.extract("epoch", Generation.created_at)
    ).where(Generation.status == "completed", Generation.completed_at.isnot(None))
    durations_res = await db.execute(durations_query)
    all_durations = sorted([float(d) for d in durations_res.scalars().all() if d is not None])

    avg_latency = (sum(all_durations) / len(all_durations)) if all_durations else 0.0
    p50_latency = 0.0
    p90_latency = 0.0
    p99_latency = 0.0
    duration_buckets = {
        "under_30s": 0,
        "30s_to_60s": 0,
        "1m_to_2m": 0,
        "2m_to_5m": 0,
        "over_5m": 0,
    }

    if all_durations:
        n = len(all_durations)
        p50_latency = round(all_durations[int(n * 0.50)], 1)
        p90_latency = round(all_durations[min(n - 1, int(n * 0.90))], 1)
        p99_latency = round(all_durations[min(n - 1, int(n * 0.99))], 1)
        for dur in all_durations:
            if dur < 30:
                duration_buckets["under_30s"] += 1
            elif dur < 60:
                duration_buckets["30s_to_60s"] += 1
            elif dur < 120:
                duration_buckets["1m_to_2m"] += 1
            elif dur < 300:
                duration_buckets["2m_to_5m"] += 1
            else:
                duration_buckets["over_5m"] += 1
    failed_count = generations_by_status.get("failed", 0)
    failure_rate = (failed_count / total_generations * 100) if total_generations > 0 else 0.0

    # 6. Keys status (round robin count). Import lazily so admin route import
    # does not crash before app startup validation can produce a clear error.
    try:
        from src.core.api_key_pool import openrouter_pool, google_pool

        openrouter_key_count = openrouter_pool.count
        google_key_count = google_pool.count
    except RuntimeError:
        openrouter_key_count = len(settings.openrouter_api_keys)
        google_key_count = len(settings.google_api_keys)

    try:
        await llm_config_service.load_from_db(db)
    except Exception:
        pass
    pro_cfg = llm_config_service.get_tier_config("pro")
    free_cfg = llm_config_service.get_tier_config("free")

    keys_status = {
        "openrouter": {
            "configured_keys_count": openrouter_key_count,
            "model": free_cfg.model,
            "base_url": free_cfg.base_url,
        },
        "pro": {
            "model": pro_cfg.model,
            "base_url": pro_cfg.base_url,
            "configured_keys_count": 1 if settings.PRO_MODEL_API_KEY else (openrouter_key_count if "openrouter.ai" in pro_cfg.base_url.lower() else 0),
        },
        "google": {
            "configured_keys_count": google_key_count,
            "model": free_cfg.fallback_model or "gemma-4-31b-it",
        },
    }

    total_tokens, avg_node_latency, fallback_count, parse_error_count, metric_count = 0, 0.0, 0, 0, 0
    try:
        metrics_result = await db.execute(
            select(
                func.coalesce(func.sum(GenerationNodeMetric.total_tokens), 0),
                func.avg(GenerationNodeMetric.latency_ms),
                func.count().filter(GenerationNodeMetric.fallback_used == True),
                func.count().filter(GenerationNodeMetric.parse_error == True),
                func.count(GenerationNodeMetric.id),
            )
        )
        row = metrics_result.one_or_none()
        if row:
            total_tokens, avg_node_latency, fallback_count, parse_error_count, metric_count = row
    except Exception as exc:
        logger.warning("[admin/analytics] Could not query generation node metrics: %s", exc)
        try:
            await db.rollback()
        except Exception:
            pass
    return {
        "total_users": total_users,
        "total_generations": total_generations,
        "generations_by_status": generations_by_status,
        "total_guest_generations": total_guest_generations,
        "average_generation_latency_seconds": round(avg_latency, 2),
        "p50_latency_seconds": p50_latency,
        "p90_latency_seconds": p90_latency,
        "p99_latency_seconds": p99_latency,
        "duration_buckets": duration_buckets,
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


@router.get("/metrics/timing-by-model", dependencies=[Depends(get_current_admin)])
async def get_timing_by_model(db: AsyncSession = Depends(get_db)):
    # 1. Models Benchmark: Group completed/failed runs by model_used
    gens_res = await db.execute(
        select(
            Generation.id,
            Generation.model_used,
            Generation.status,
            Generation.created_at,
            Generation.completed_at,
        ).where(Generation.created_at.isnot(None))
    )
    all_gens = gens_res.all()

    tokens_res = await db.execute(
        select(
            GenerationNodeMetric.generation_id,
            func.coalesce(func.sum(GenerationNodeMetric.total_tokens), 0),
        )
        .where(GenerationNodeMetric.generation_id.isnot(None))
        .group_by(GenerationNodeMetric.generation_id)
    )
    tokens_by_gen = {row[0]: int(row[1]) for row in tokens_res.all()}

    # Query primary provider per generation from GenerationNodeMetric
    providers_res = await db.execute(
        select(
            GenerationNodeMetric.generation_id,
            GenerationNodeMetric.provider,
            func.count(GenerationNodeMetric.id),
        )
        .where(GenerationNodeMetric.generation_id.isnot(None))
        .group_by(GenerationNodeMetric.generation_id, GenerationNodeMetric.provider)
        .order_by(GenerationNodeMetric.generation_id, desc(func.count(GenerationNodeMetric.id)))
    )
    primary_provider_by_gen: dict[uuid.UUID, str] = {}
    for gen_id_val, prov, _ in providers_res.all():
        if gen_id_val and gen_id_val not in primary_provider_by_gen:
            primary_provider_by_gen[gen_id_val] = (prov or "").lower()

    model_groups: dict[str, list[dict]] = {}
    for row in all_gens:
        raw_model = row.model_used or "unknown"
        gen_provider = primary_provider_by_gen.get(row.id, "")

        # Distinguish Gemma 4 from Cerebras vs Google Gemini
        if "gemma" in raw_model.lower():
            if gen_provider == "google":
                model_key = "gemma-4-31b-it (Google Gemini)"
            else:
                # Historical default was Cerebras API
                model_key = "gemma-4-31b-it (Cerebras)"
        elif "gemini-3.7" in raw_model.lower() or "antigravity" in raw_model.lower():
            model_key = "gemini-3.7-flash-tiered (OmniRoute)"
        elif "laguna" in raw_model.lower() or "poolside" in raw_model.lower():
            model_key = "laguna-xs-2.1:free (OpenRouter)"
        else:
            model_key = raw_model

        dur = None
        if row.completed_at and row.created_at:
            dur = max(0.0, (row.completed_at - row.created_at).total_seconds())
        if model_key not in model_groups:
            model_groups[model_key] = []
        model_groups[model_key].append({
            "id": row.id,
            "status": row.status,
            "duration": dur,
            "tokens": tokens_by_gen.get(row.id, 0),
        })

    models_benchmark = []
    for model_name, items in model_groups.items():
        total_runs = len(items)
        completed_items = [it for it in items if it["status"] == "completed" and it["duration"] is not None]
        failed_count = sum(1 for it in items if it["status"] == "failed")
        completed_count = len(completed_items)
        failure_rate = round((failed_count / total_runs * 100), 1) if total_runs > 0 else 0.0
        durations = sorted([it["duration"] for it in completed_items if it["duration"] is not None])
        avg_dur = round(sum(durations) / len(durations), 1) if durations else 0.0
        p50_dur = round(durations[int(len(durations) * 0.5)], 1) if durations else 0.0
        p90_dur = round(durations[min(len(durations) - 1, int(len(durations) * 0.9))], 1) if durations else 0.0
        min_dur = round(durations[0], 1) if durations else 0.0
        max_dur = round(durations[-1], 1) if durations else 0.0
        total_toks = sum(it["tokens"] for it in items)

        models_benchmark.append({
            "model_name": model_name,
            "total_runs": total_runs,
            "completed_runs": completed_count,
            "failed_runs": failed_count,
            "failure_rate": failure_rate,
            "avg_duration_seconds": avg_dur,
            "p50_duration_seconds": p50_dur,
            "p90_duration_seconds": p90_dur,
            "min_duration_seconds": min_dur,
            "max_duration_seconds": max_dur,
            "total_tokens": total_toks,
        })
    models_benchmark.sort(key=lambda x: x["total_runs"], reverse=True)

    # 2. Templates Benchmark
    tpl_res = await db.execute(
        select(
            Generation.template_id,
            func.count(Generation.id),
            func.avg(func.extract("epoch", Generation.completed_at) - func.extract("epoch", Generation.created_at)),
        )
        .where(Generation.status == "completed", Generation.completed_at.isnot(None))
        .group_by(Generation.template_id)
        .order_by(desc(func.count(Generation.id)))
    )
    templates_benchmark = [
        {
            "template_id": row[0],
            "total_runs": row[1],
            "avg_duration_seconds": round(float(row[2] or 0), 1),
        }
        for row in tpl_res.all()
    ]

    # 3. Nodes by Model Benchmark
    nodes_res = await db.execute(
        select(
            GenerationNodeMetric.node_name,
            GenerationNodeMetric.provider,
            GenerationNodeMetric.model,
            func.count(GenerationNodeMetric.id),
            func.avg(GenerationNodeMetric.latency_ms),
            func.coalesce(func.sum(GenerationNodeMetric.total_tokens), 0),
            func.count().filter(GenerationNodeMetric.status == "error"),
            func.count().filter(GenerationNodeMetric.fallback_used == True),
        )
        .group_by(GenerationNodeMetric.node_name, GenerationNodeMetric.provider, GenerationNodeMetric.model)
        .order_by(GenerationNodeMetric.node_name, desc(func.count(GenerationNodeMetric.id)))
    )
    nodes_by_model = [
        {
            "node_name": row[0],
            "provider": row[1],
            "model": (
                f"{row[2]} (Cerebras)" if row[1] == "cerebras" and "gemma" in (row[2] or "").lower()
                else f"{row[2]} (Google Gemini)" if row[1] == "google" and "gemma" in (row[2] or "").lower()
                else (row[2] or "default")
            ),
            "calls": row[3],
            "avg_latency_ms": round(float(row[4] or 0), 1),
            "total_tokens": int(row[5] or 0),
            "errors": row[6],
            "fallbacks": row[7],
        }
        for row in nodes_res.all()
    ]

    # 4. Top 10 Slowest Completed Runs
    slow_res = await db.execute(
        select(
            Generation.id,
            Generation.job_title,
            Generation.company,
            Generation.model_used,
            Generation.template_id,
            Generation.created_at,
            Generation.completed_at,
            User.email,
            (func.extract("epoch", Generation.completed_at) - func.extract("epoch", Generation.created_at)).label("dur_sec"),
        )
        .outerjoin(User, Generation.user_id == User.id)
        .where(Generation.status == "completed", Generation.completed_at.isnot(None))
        .order_by(desc("dur_sec"))
        .limit(10)
    )
    slowest_runs = [
        {
            "id": str(row[0]),
            "job_title": row[1] or "Unknown Title",
            "company": row[2] or "Unknown Company",
            "model_used": (
                f"{row[3]} (Google Gemini)" if "gemma" in (row[3] or "").lower() and primary_provider_by_gen.get(row[0]) == "google"
                else f"{row[3]} (Cerebras)" if "gemma" in (row[3] or "").lower()
                else row[3]
            ),
            "template_id": row[4],
            "created_at": row[5].isoformat() if row[5] else "",
            "completed_at": row[6].isoformat() if row[6] else "",
            "email": row[7] or "Guest",
            "duration_seconds": round(float(row[8] or 0), 1),
        }
        for row in slow_res.all()
    ]
    return {
        "models_benchmark": models_benchmark,
        "templates_benchmark": templates_benchmark,
        "nodes_by_model": nodes_by_model,
        "slowest_runs": slowest_runs,
    }


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


async def _render_generation_pdf(
    gen: Generation,
    resume_data: dict[str, Any],
    font_size: float | None,
    filename_prefix: str,
) -> Response:
    template_manifest = TemplateRegistryService.get_template_manifest(gen.template_id)
    if not template_manifest:
        raise HTTPException(status_code=500, detail="Template files missing.")

    if gen.is_guest and gen.guest_input_snapshot:
        profile_data = gen.guest_input_snapshot.get("profile") or {}
    else:
        async with AsyncSessionLocal() as db:
            from src.models.profile import Profile
            profile_res = await db.execute(select(Profile).where(Profile.user_id == gen.user_id))
            profile = profile_res.scalar_one_or_none()
            if not profile:
                raise HTTPException(status_code=404, detail="Profile not found")
            profile_data = {
                "full_name": profile.full_name,
                "email": profile.email,
                "phone": profile.phone,
                "location": profile.location,
                "linkedin_url": profile.linkedin_url,
                "github_url": profile.github_url,
                "portfolio_url": profile.portfolio_url,
                "subtitle": profile.subtitle,
            }

    html = TemplateRegistryService.render_template(
        gen.template_id,
        {
            "profile": profile_data,
            "resume": resume_data,
            "font_size": font_size or template_manifest.max_font_size,
            "page_margin_mm": template_manifest.page_margin_mm,
        },
    )
    if not html:
        raise HTTPException(status_code=500, detail="Template rendering failed.")

    try:
        from weasyprint import HTML
    except (OSError, ImportError) as exc:
        raise HTTPException(status_code=500, detail=f"PDF rendering unavailable: {exc}")

    pdf = HTML(string=html, base_url=str(settings.TEMPLATES_DIR / gen.template_id)).write_pdf()
    filename = f"{filename_prefix}-{gen.id}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


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
        duration_sec = None
        if gen.completed_at and gen.created_at:
            duration_sec = round((gen.completed_at - gen.created_at).total_seconds(), 1)
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
                duration_seconds=duration_sec,
                is_guest=gen.is_guest,
                error_message=gen.error_message,
                intermediate_resume_count=len((gen.render_metadata or {}).get("intermediate_resumes") or []),
            )
        )
    return output


@router.get("/generations/{id}/intermediate/{index}/download", dependencies=[Depends(get_current_admin)])
async def download_intermediate_resume(id: uuid.UUID, index: int, db: AsyncSession = Depends(get_db)):
    gen_res = await db.execute(select(Generation).where(Generation.id == id))
    gen = gen_res.scalar_one_or_none()
    if not gen:
        raise HTTPException(status_code=404, detail="Generation not found")

    intermediates = (gen.render_metadata or {}).get("intermediate_resumes") or []
    if index < 0 or index >= len(intermediates):
        raise HTTPException(status_code=404, detail="Intermediate resume not found")

    snapshot = intermediates[index]
    resume_data = snapshot.get("tailored_resume")
    if not resume_data:
        raise HTTPException(status_code=404, detail="Intermediate resume data missing")
    return await _render_generation_pdf(gen, resume_data, snapshot.get("font_size"), "intermediate")


@router.get("/generations/{id}/download", dependencies=[Depends(get_current_admin)])
async def download_final_resume(id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    gen_res = await db.execute(select(Generation).where(Generation.id == id))
    gen = gen_res.scalar_one_or_none()
    if not gen:
        raise HTTPException(status_code=404, detail="Generation not found")
    if gen.status != "completed":
        raise HTTPException(status_code=400, detail="Generation is not completed yet")

    metadata = gen.render_metadata or {}
    resume_data = metadata.get("tailored_resume")
    if not resume_data:
        raise HTTPException(status_code=404, detail="Final resume data missing")
    return await _render_generation_pdf(gen, resume_data, metadata.get("font_size"), "final")


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
        is_admin = bool(u.email and (u.email in settings.admin_emails or "*" in settings.admin_emails))
        is_pro = bool(getattr(u, "is_pro", False) or is_admin)
        output.append(
            {
                "id": u.id,
                "email": u.email,
                "name": u.name,
                "created_at": u.created_at,
                "provider": u.provider,
                "is_pro": is_pro,
                "is_admin": is_admin,
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


@router.get("/model-settings", dependencies=[Depends(get_current_admin)])
async def get_model_settings(db: AsyncSession = Depends(get_db)):
    await llm_config_service.load_from_db(db)
    configs = llm_config_service.get_all_configs()
    response = {}
    for tier_key, cfg in configs.items():
        response[tier_key] = {
            "tier": cfg.tier,
            "provider_name": cfg.provider_name,
            "base_url": cfg.base_url,
            "model": cfg.model,
            "temperature": cfg.temperature,
            "fallback_provider": cfg.fallback_provider,
            "fallback_model": cfg.fallback_model,
            "extra_headers": cfg.extra_headers,
            "is_active": cfg.is_active,
            "updated_at": cfg.updated_at.isoformat() if cfg.updated_at else None,
        }
    return response


@router.put("/model-settings", dependencies=[Depends(get_current_admin)])
async def update_model_settings(data: ModelSettingsUpdate, db: AsyncSession = Depends(get_db)):
    updated = await llm_config_service.update_tier_config(
        db=db,
        tier=data.tier,
        base_url=data.base_url,
        model=data.model,
        temperature=data.temperature,
        provider_name=data.provider_name,
        fallback_provider=data.fallback_provider,
        fallback_model=data.fallback_model,
        extra_headers=data.extra_headers,
    )
    return {
        "tier": updated.tier,
        "provider_name": updated.provider_name,
        "base_url": updated.base_url,
        "model": updated.model,
        "temperature": updated.temperature,
        "fallback_provider": updated.fallback_provider,
        "fallback_model": updated.fallback_model,
        "extra_headers": updated.extra_headers,
        "is_active": updated.is_active,
        "updated_at": updated.updated_at.isoformat() if updated.updated_at else None,
    }


@router.post("/model-settings/test", dependencies=[Depends(get_current_admin)])
async def test_model_endpoint(data: ModelTestRequest, db: AsyncSession = Depends(get_db)):
    started = time.perf_counter()
    tier = data.tier.lower()
    try:
        if data.base_url or data.model:
            base_url = (data.base_url or (settings.PRO_MODEL_BASE_URL if tier == "pro" else settings.FREE_MODEL_BASE_URL)).rstrip("/")
            model = data.model or (settings.PRO_MODEL_NAME if tier == "pro" else settings.FREE_MODEL_NAME)
            is_openrouter = "openrouter.ai" in base_url.lower()

            if is_openrouter:
                from src.core.api_key_pool import openrouter_pool
                api_key = openrouter_pool.next() if openrouter_pool.count > 0 else "dummy-key"
            elif tier == "pro":
                if settings.PRO_MODEL_API_KEY and settings.PRO_MODEL_API_KEY.strip():
                    api_key = settings.PRO_MODEL_API_KEY.strip()
                else:
                    api_key = "dummy-key"
            else:
                from src.core.api_key_pool import openrouter_pool
                api_key = openrouter_pool.next() if openrouter_pool.count > 0 else "dummy-key"

            from langchain_openai import ChatOpenAI
            headers = {"HTTP-Referer": settings.FRONTEND_URL, "X-Title": "Resumer"} if is_openrouter else None
            llm = ChatOpenAI(
                model=model,
                base_url=base_url,
                api_key=api_key or "dummy-key",
                temperature=0.0,
                default_headers=headers,
            )
        else:
            await llm_config_service.load_from_db(db)
            llm = llm_config_service.get_llm(tier=tier)

        prompt_text = data.prompt or "Respond with a brief greeting containing the word 'pong'."
        from langchain_core.messages import HumanMessage
        response = await asyncio.wait_for(llm.ainvoke([HumanMessage(content=prompt_text)]), timeout=30.0)
        latency_ms = (time.perf_counter() - started) * 1000
        output_text = _message_content_to_text(response.content)

        return {
            "success": True,
            "latency_ms": round(latency_ms, 2),
            "output": output_text,
            "model_used": getattr(llm, "model_name", None) or getattr(llm, "model", None),
            "tier": tier,
        }
    except Exception as exc:
        latency_ms = (time.perf_counter() - started) * 1000
        return {
            "success": False,
            "latency_ms": round(latency_ms, 2),
            "error": str(exc),
            "tier": tier,
        }


@router.patch("/users/{id}/tier", dependencies=[Depends(get_current_admin)])
async def update_user_tier(id: uuid.UUID, data: UserTierUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.id == id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.is_pro = data.is_pro
    await db.commit()
    await db.refresh(user)

    is_admin = bool(user.email and (user.email in settings.admin_emails or "*" in settings.admin_emails))
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "is_pro": user.is_pro,
        "is_admin": is_admin,
    }


@router.put("/users/{id}/pro", dependencies=[Depends(get_current_admin)])
async def set_user_pro_status(id: uuid.UUID, data: UserTierUpdate, db: AsyncSession = Depends(get_db)):
    return await update_user_tier(id, data, db)


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


# ── Feedback Admin Endpoints ──────────────────────────────────────────────────


class SupportReportStatusUpdate(BaseModel):
    status: str
    admin_note: str | None = None


@router.get("/feedback/analytics", dependencies=[Depends(get_current_admin)])
async def get_feedback_analytics(db: AsyncSession = Depends(get_db)):
    from src.models.generation import FeedbackRating, SupportReport

    total_reports = await db.scalar(select(func.count(SupportReport.id))) or 0
    open_reports = await db.scalar(select(func.count(SupportReport.id)).where(SupportReport.status == "open")) or 0
    resolved_reports = await db.scalar(select(func.count(SupportReport.id)).where(SupportReport.status == "resolved")) or 0

    total_ratings = await db.scalar(select(func.count(FeedbackRating.id))) or 0
    avg_rating = await db.scalar(select(func.avg(FeedbackRating.star_rating))) or 0.0

    # Rating distribution
    distribution = {}
    for star in range(1, 6):
        count = await db.scalar(select(func.count(FeedbackRating.id)).where(FeedbackRating.star_rating == star)) or 0
        distribution[str(star)] = count

    # Category breakdown
    categories_res = await db.execute(
        select(SupportReport.category, func.count(SupportReport.id))
        .group_by(SupportReport.category)
    )
    categories = {row[0] or "other": row[1] for row in categories_res.all()}

    return {
        "total_reports": total_reports,
        "open_count": open_reports,
        "resolved_count": resolved_reports,
        "avg_rating": round(float(avg_rating), 2),
        "total_ratings": total_ratings,
        "rating_distribution": distribution,
        "reports_by_category": categories,
    }


@router.get("/feedback/reports", dependencies=[Depends(get_current_admin)])
async def list_support_reports(
    limit: int = 50,
    offset: int = 0,
    status_filter: str | None = None,
    category_filter: str | None = None,
    search: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    from src.models.generation import ReportAttachment, SupportReport

    query = (
        select(SupportReport, User.email, User.name, func.count(ReportAttachment.id))
        .outerjoin(User, SupportReport.user_id == User.id)
        .outerjoin(ReportAttachment, SupportReport.id == ReportAttachment.report_id)
        .group_by(SupportReport.id, User.email, User.name)
    )

    if status_filter:
        query = query.where(SupportReport.status == status_filter)
    if category_filter:
        query = query.where(SupportReport.category == category_filter)
    if search:
        like = f"%{search.strip()}%"
        query = query.where(
            or_(
                SupportReport.message.ilike(like),
                User.email.ilike(like),
                SupportReport.email_override.ilike(like),
                SupportReport.auto_summary.ilike(like),
            )
        )

    query = query.order_by(desc(SupportReport.created_at)).offset(offset).limit(limit)
    result = await db.execute(query)
    output = []
    for row in result.all():
        report = row[0]
        user_email = row[1] or report.email_override
        user_name = row[2]
        att_count = row[3] or 0

        output.append(
            {
                "id": report.id,
                "user_id": report.user_id,
                "user_email": user_email,
                "user_name": user_name,
                "email_override": report.email_override,
                "message": report.message,
                "status": report.status,
                "category": report.category,
                "admin_note": report.admin_note,
                "auto_summary": report.auto_summary,
                "sentiment_score": report.sentiment_score,
                "generation_id": report.generation_id,
                "created_at": report.created_at,
                "updated_at": report.updated_at,
                "resolved_at": report.resolved_at,
                "attachment_count": att_count,
            }
        )
    return output


@router.get("/feedback/reports/{id}", dependencies=[Depends(get_current_admin)])
async def get_support_report_detail(id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    from src.models.generation import ReportAttachment, SupportReport

    report_res = await db.execute(select(SupportReport).where(SupportReport.id == id))
    report = report_res.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Support report not found")

    user_email = report.email_override
    user_name = None
    if report.user_id:
        u_res = await db.execute(select(User).where(User.id == report.user_id))
        user = u_res.scalar_one_or_none()
        if user:
            user_email = user.email
            user_name = user.name

    att_res = await db.execute(
        select(ReportAttachment).where(ReportAttachment.report_id == id)
    )
    attachments = att_res.scalars().all()

    storage = StorageService()
    attachment_list = []
    for att in attachments:
        presigned_url = storage.get_presigned_url(att.storage_key, expires_in=3600)
        attachment_list.append(
            {
                "id": att.id,
                "attachment_type": att.attachment_type,
                "storage_key": att.storage_key,
                "presigned_url": presigned_url,
                "filename": att.filename,
                "mime_type": att.mime_type,
                "file_size_bytes": att.file_size_bytes,
                "transcription": att.transcription,
                "created_at": att.created_at,
            }
        )

    return {
        "id": report.id,
        "user_id": report.user_id,
        "user_email": user_email,
        "user_name": user_name,
        "email_override": report.email_override,
        "message": report.message,
        "status": report.status,
        "category": report.category,
        "admin_note": report.admin_note,
        "auto_summary": report.auto_summary,
        "sentiment_score": report.sentiment_score,
        "generation_id": report.generation_id,
        "created_at": report.created_at,
        "updated_at": report.updated_at,
        "resolved_at": report.resolved_at,
        "attachments": attachment_list,
    }


@router.patch("/feedback/reports/{id}", dependencies=[Depends(get_current_admin)])
async def update_support_report_status(
    id: uuid.UUID,
    data: SupportReportStatusUpdate,
    db: AsyncSession = Depends(get_db),
):
    from src.models.generation import SupportReport

    report_res = await db.execute(select(SupportReport).where(SupportReport.id == id))
    report = report_res.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Support report not found")

    old_status = report.status
    report.status = data.status
    if data.admin_note is not None:
        report.admin_note = data.admin_note

    if data.status == "resolved" and old_status != "resolved":
        report.resolved_at = datetime.now(timezone.utc)
        # Trigger resolution email
        target_email = report.email_override
        if report.user_id:
            u_res = await db.execute(select(User).where(User.id == report.user_id))
            user = u_res.scalar_one_or_none()
            if user:
                target_email = user.email
        if target_email:
            try:
                from src.core.notify import send_support_resolved_email
                send_support_resolved_email(target_email, report.id, report.admin_note or "")
            except Exception as e:
                logger.error(f"Failed to send resolution email to {target_email}: {e}")

    await db.commit()
    return {"status": "success", "report_status": report.status}


@router.delete("/feedback/reports/{id}", dependencies=[Depends(get_current_admin)])
async def delete_support_report(id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    from src.models.generation import ReportAttachment, SupportReport

    report_res = await db.execute(select(SupportReport).where(SupportReport.id == id))
    report = report_res.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Support report not found")

    att_res = await db.execute(select(ReportAttachment).where(ReportAttachment.report_id == id))
    attachments = att_res.scalars().all()

    storage = StorageService()
    for att in attachments:
        if att.storage_key:
            storage.delete_file(att.storage_key)

    await db.execute(delete(SupportReport).where(SupportReport.id == id))
    await db.commit()
    return {"status": "success", "message": f"Support report {id} deleted successfully"}


@router.get("/feedback/ratings", dependencies=[Depends(get_current_admin)])
async def list_feedback_ratings(
    limit: int = 50,
    offset: int = 0,
    min_stars: int | None = None,
    max_stars: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    from src.models.generation import FeedbackRating

    query = (
        select(FeedbackRating, User.email, User.name, Generation.job_title)
        .outerjoin(User, FeedbackRating.user_id == User.id)
        .outerjoin(Generation, FeedbackRating.generation_id == Generation.id)
    )

    if min_stars is not None:
        query = query.where(FeedbackRating.star_rating >= min_stars)
    if max_stars is not None:
        query = query.where(FeedbackRating.star_rating <= max_stars)

    query = query.order_by(desc(FeedbackRating.created_at)).offset(offset).limit(limit)
    result = await db.execute(query)

    output = []
    for row in result.all():
        rating = row[0]
        email = row[1]
        name = row[2]
        job_title = row[3]
        output.append(
            {
                "id": rating.id,
                "user_id": rating.user_id,
                "user_email": email,
                "user_name": name,
                "generation_id": rating.generation_id,
                "generation_job_title": job_title,
                "star_rating": rating.star_rating,
                "comment": rating.comment,
                "dismissed": rating.dismissed,
                "created_at": rating.created_at,
            }
        )
    return output

