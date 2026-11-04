"""Non-blocking generation telemetry. Database state remains authoritative."""
import logging
import uuid
from functools import lru_cache
from datetime import timezone
from typing import Literal

from posthog import Posthog

from src.core.config import settings
from src.models.generation import Generation

logger = logging.getLogger(__name__)
GenerationEvent = Literal["accepted", "completed", "failed"]


@lru_cache(maxsize=1)
def _client() -> Posthog:
    return Posthog(
        settings.POSTHOG_PROJECT_TOKEN,
        host=settings.POSTHOG_HOST,
        flush_interval=2,
        timeout=5,
        max_retries=3,
        on_error=lambda error, batch: logger.warning("PostHog delivery failed: %s", type(error).__name__),
    )


def capture_generation(gen: Generation, outcome: GenerationEvent) -> None:
    if not settings.POSTHOG_PROJECT_TOKEN or settings.POSTHOG_ENVIRONMENT != "production":
        return
    try:
        metadata = gen.render_metadata or {}
        context = metadata.get("_analytics")
        if "_analytics" in metadata and not context:
            return
        context = context or {}
        properties = {
            "run_id": str(gen.id),
            "template_id": gen.template_id,
            "is_guest": bool(gen.is_guest),
            "source": context.get("source", "website") if context else "api",
            "environment": settings.POSTHOG_ENVIRONMENT,
            "$process_person_profile": False,
        }
        if context.get("session_id"):
            properties["$session_id"] = context["session_id"]
        if outcome != "accepted" and gen.completed_at and gen.created_at:
            started = gen.created_at.replace(tzinfo=timezone.utc) if gen.created_at.tzinfo is None else gen.created_at
            ended = gen.completed_at.replace(tzinfo=timezone.utc) if gen.completed_at.tzinfo is None else gen.completed_at
            properties["duration_seconds"] = max(0, (ended - started).total_seconds())
        event_id = uuid.uuid5(uuid.NAMESPACE_URL, f"resumer:{gen.id}:{outcome}")
        _client().capture(
            f"resume_generation_{outcome}",
            distinct_id=context.get("distinct_id") or f"api-user:{gen.user_id}",
            properties=properties,
            uuid=event_id,
        )
    except Exception:
        logger.warning("Could not queue generation analytics", exc_info=True)


def shutdown_analytics() -> None:
    if _client.cache_info().currsize:
        _client().shutdown()
