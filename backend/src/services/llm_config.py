"""Dynamic LLM Provider & Model Configuration Service.

Manages dynamic runtime configurations for Free and Pro tiers:
- Pro Tier: Dedicated endpoint hosting Google Gemini 3.7 Flash Tiered via OmniRoute gateway.
- Free Tier: OpenRouter multi-key pool hosting Laguna model (poolside/laguna-xs-2.1:free).
- Fallback: Google GenAI (gemma-4-31b-it via Gemini API).

Thread-safe in-memory cache synchronized with PostgreSQL (llm_provider_configs table).
"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.api_key_pool import cerebras_pool, google_pool, openrouter_pool, pro_pool
from src.core.config import settings
from src.models.generation import LLMProviderConfig

logger = logging.getLogger(__name__)


@dataclass
class TierConfig:
    tier: str  # "free" | "pro"
    provider_name: str
    base_url: str
    model: str
    temperature: float = 0.2
    fallback_provider: str | None = "google"
    fallback_model: str | None = "gemma-4-31b-it"
    extra_headers: dict[str, str] = field(default_factory=dict)
    is_active: bool = True
    updated_at: datetime | None = None


class LLMConfigService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._cache: dict[str, TierConfig] = {}
        self._initialized = False
        self._init_defaults()

    def _init_defaults(self) -> None:
        """Populate initial in-memory defaults from environment settings."""
        self._cache["pro"] = TierConfig(
            tier="pro",
            provider_name="omniroute",
            base_url=settings.PRO_MODEL_BASE_URL or "https://omniroute-latest-rmm0.onrender.com/",
            model=settings.PRO_MODEL_NAME or "antigravity/gemini-3.7-flash-tiered",
            temperature=0.2,
            fallback_provider="google",
            fallback_model="gemma-4-31b-it",
            extra_headers={},
            is_active=True,
            updated_at=datetime.now(timezone.utc),
        )

        self._cache["free"] = TierConfig(
            tier="free",
            provider_name="openrouter",
            base_url=settings.FREE_MODEL_BASE_URL or "https://openrouter.ai/api/v1",
            model=settings.FREE_MODEL_NAME or "poolside/laguna-xs-2.1:free",
            temperature=0.2,
            fallback_provider="google",
            fallback_model="gemma-4-31b-it",
            extra_headers={
                "HTTP-Referer": settings.FRONTEND_URL,
                "X-Title": "Resumer",
            },
            is_active=True,
            updated_at=datetime.now(timezone.utc),
        )


    def get_tier_config(self, tier: str = "free") -> TierConfig:
        tier_key = "pro" if str(tier).lower() in ("pro", "true", "1") else "free"
        with self._lock:
            if tier_key in self._cache:
                return self._cache[tier_key]
        self._init_defaults()
        return self._cache[tier_key]

    def get_all_configs(self) -> dict[str, TierConfig]:
        with self._lock:
            return dict(self._cache)

    async def load_from_db(self, db: AsyncSession | None = None) -> None:
        """Load tier configurations from PostgreSQL database into memory."""
        from src.core.database import AsyncSessionLocal

        async def _load_records(session: AsyncSession) -> None:
            result = await session.execute(select(LLMProviderConfig))
            records = result.scalars().all()
            if not records:
                # Seed defaults into database if table is empty
                for tier_name, cfg in self._cache.items():
                    session.add(
                        LLMProviderConfig(
                            tier=cfg.tier,
                            provider_name=cfg.provider_name,
                            base_url=cfg.base_url,
                            model=cfg.model,
                            temperature=cfg.temperature,
                            fallback_provider=cfg.fallback_provider,
                            fallback_model=cfg.fallback_model,
                            extra_headers=cfg.extra_headers,
                            is_active=cfg.is_active,
                        )
                    )
                await session.commit()
                return

            with self._lock:
                for row in records:
                    self._cache[row.tier] = TierConfig(
                        tier=row.tier,
                        provider_name=row.provider_name,
                        base_url=row.base_url,
                        model=row.model,
                        temperature=row.temperature,
                        fallback_provider=row.fallback_provider,
                        fallback_model=row.fallback_model,
                        extra_headers=row.extra_headers or {},
                        is_active=row.is_active,
                        updated_at=row.updated_at,
                    )
            self._initialized = True

        try:
            if db is not None:
                await _load_records(db)
            else:
                async with AsyncSessionLocal() as session:
                    await _load_records(session)
        except Exception as exc:
            logger.warning("Could not load LLMProviderConfig from DB; using environment defaults: %s", exc)
            if db is not None:
                try:
                    await db.rollback()
                except Exception:
                    pass
    async def update_tier_config(
        self,
        db: AsyncSession,
        tier: str,
        base_url: str,
        model: str,
        temperature: float = 0.2,
        provider_name: str | None = None,
        fallback_provider: str | None = "google",
        fallback_model: str | None = "gemma-4-31b-it",
        extra_headers: dict[str, str] | None = None,
    ) -> TierConfig:
        tier_key = "pro" if tier.lower() in ("pro", "true") else "free"
        cleaned_url = base_url.strip()
        cleaned_model = model.strip()

        def _infer_provider_name(url: str) -> str:
            u = url.lower()
            if "openrouter.ai" in u:
                return "openrouter"
            if "omniroute" in u:
                return "omniroute"
            if "cerebras.ai" in u:
                return "cerebras"
            if "groq.com" in u:
                return "groq"
            return "openai_compatible"

        resolved_provider = provider_name or _infer_provider_name(cleaned_url)

        result = await db.execute(select(LLMProviderConfig).where(LLMProviderConfig.tier == tier_key))
        config_row = result.scalar_one_or_none()

        if not config_row:
            config_row = LLMProviderConfig(
                tier=tier_key,
                provider_name=resolved_provider,
                base_url=cleaned_url,
                model=cleaned_model,
                temperature=temperature,
                fallback_provider=fallback_provider,
                fallback_model=fallback_model,
                extra_headers=extra_headers or {},
                is_active=True,
            )
            db.add(config_row)
        else:
            config_row.base_url = cleaned_url
            config_row.model = cleaned_model
            config_row.temperature = temperature
            config_row.provider_name = resolved_provider
            config_row.fallback_provider = fallback_provider
            config_row.fallback_model = fallback_model
            if extra_headers is not None:
                config_row.extra_headers = extra_headers
        await db.commit()
        await db.refresh(config_row)

        updated = TierConfig(
            tier=config_row.tier,
            provider_name=config_row.provider_name,
            base_url=config_row.base_url,
            model=config_row.model,
            temperature=config_row.temperature,
            fallback_provider=config_row.fallback_provider,
            fallback_model=config_row.fallback_model,
            extra_headers=config_row.extra_headers or {},
            is_active=config_row.is_active,
            updated_at=config_row.updated_at,
        )

        with self._lock:
            self._cache[tier_key] = updated

        return updated

    def get_llm(
        self,
        tier: str = "free",
        api_key_override: str | None = None,
    ) -> ChatOpenAI:
        """Create and return a configured ChatOpenAI client for the requested tier."""
        cfg = self.get_tier_config(tier)
        url_lower = cfg.base_url.lower()
        if "openrouter.ai" in url_lower:
            resolved_provider = "openrouter"
        elif "cerebras.ai" in url_lower:
            resolved_provider = "cerebras"
        elif "omniroute" in url_lower:
            resolved_provider = "omniroute"
        elif cfg.provider_name and cfg.provider_name not in ("openai_compatible", "default"):
            resolved_provider = cfg.provider_name
        else:
            resolved_provider = "openai_compatible"

        is_openrouter = resolved_provider == "openrouter"

        api_key = api_key_override
        if not api_key:
            if resolved_provider == "cerebras":
                api_key = cerebras_pool.next() if cerebras_pool.count > 0 else "dummy-key"
            elif resolved_provider == "omniroute":
                if pro_pool.count > 0:
                    api_key = pro_pool.next()
                elif settings.PRO_MODEL_API_KEY and settings.PRO_MODEL_API_KEY.strip():
                    api_key = settings.PRO_MODEL_API_KEY.strip()
                else:
                    api_key = "dummy-key"
            elif resolved_provider == "openrouter":
                api_key = openrouter_pool.next() if openrouter_pool.count > 0 else "dummy-key"
            elif cfg.tier == "pro":
                if pro_pool.count > 0:
                    api_key = pro_pool.next()
                elif settings.PRO_MODEL_API_KEY and settings.PRO_MODEL_API_KEY.strip():
                    api_key = settings.PRO_MODEL_API_KEY.strip()
                elif openrouter_pool.count > 0:
                    api_key = openrouter_pool.next()
                else:
                    api_key = "dummy-key"
            else:
                api_key = openrouter_pool.next() if openrouter_pool.count > 0 else "dummy-key"
        headers: dict[str, str] = {}
        if is_openrouter:
            headers["HTTP-Referer"] = settings.FRONTEND_URL
            headers["X-Title"] = "Resumer"
        if cfg.extra_headers:
            headers.update(cfg.extra_headers)

        return ChatOpenAI(
            model=cfg.model,
            temperature=cfg.temperature,
            base_url=cfg.base_url.rstrip("/"),
            api_key=api_key,
            default_headers=headers if headers else None,
        )

    def get_fallback_llm(
        self,
        tier: str = "free",
        api_key_override: str | None = None,
    ) -> BaseChatModel:
        """Create and return a configured fallback Chat model."""
        cfg = self.get_tier_config(tier)
        fallback_provider = (cfg.fallback_provider or "google").lower()
        fallback_model = cfg.fallback_model or "gemma-4-31b-it"

        if fallback_provider == "openrouter":
            key = api_key_override or (openrouter_pool.next() if openrouter_pool.count > 0 else "dummy-key")
            return ChatOpenAI(
                model=fallback_model,
                temperature=cfg.temperature,
                base_url="https://openrouter.ai/api/v1",
                api_key=key,
                default_headers={"HTTP-Referer": settings.FRONTEND_URL, "X-Title": "Resumer"},
            )
        elif fallback_provider == "cerebras":
            key = api_key_override or (cerebras_pool.next() if cerebras_pool.count > 0 else "dummy-key")
            return ChatOpenAI(
                model=fallback_model,
                temperature=cfg.temperature,
                base_url="https://api.cerebras.ai/v1",
                api_key=key,
            )
        else:
            api_key = api_key_override or (google_pool.next() if google_pool.count > 0 else "dummy-key")
            return ChatGoogleGenerativeAI(
                model=fallback_model,
                temperature=cfg.temperature,
                google_api_key=api_key,
            )

async def ensure_llm_provider_schema() -> None:
    """Idempotently ensure is_pro column on users and llm_provider_configs table exist on startup."""
    from src.core.database import engine

    try:
        async with engine.begin() as conn:
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_pro BOOLEAN NOT NULL DEFAULT false;"))
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS llm_provider_configs (
                    tier VARCHAR PRIMARY KEY,
                    provider_name VARCHAR NOT NULL DEFAULT 'openai_compatible',
                    base_url VARCHAR NOT NULL,
                    model VARCHAR NOT NULL,
                    temperature FLOAT NOT NULL DEFAULT 0.2,
                    fallback_provider VARCHAR DEFAULT 'google',
                    fallback_model VARCHAR DEFAULT 'gemma-4-31b-it',
                    extra_headers JSONB,
                    is_active BOOLEAN NOT NULL DEFAULT true,
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
                );
            """))
            await conn.execute(text("ALTER TABLE llm_provider_configs DROP COLUMN IF EXISTS api_keys;"))
    except Exception as exc:
        logger.warning("[llm_config/startup] ensure_llm_provider_schema warning: %s", exc)


# Global singleton instance
llm_config_service = LLMConfigService()
