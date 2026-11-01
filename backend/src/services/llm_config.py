"""Gemini-only clients through OmniRoute and independently keyed OpenRouter."""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from urllib.parse import urlsplit
import re

from langchain_openai import ChatOpenAI
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.api_key_pool import openrouter_pool, pro_pool, ApiKeyUnavailable
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
    fallback_provider: str | None = "openrouter"
    fallback_model: str | None = settings.OPENROUTER_FALLBACK_MODEL
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
            model=settings.PRO_MODEL_NAME or "gemini-3.8-flash-tiered",
            temperature=0.2,
            fallback_provider="openrouter",
            fallback_model=settings.OPENROUTER_FALLBACK_MODEL,
            extra_headers={},
            is_active=True,
            updated_at=datetime.now(timezone.utc),
        )

        self._cache["free"] = TierConfig(
            tier="free",
            provider_name="openrouter",
            base_url=settings.FREE_MODEL_BASE_URL or "https://openrouter.ai/api/v1",
            model=settings.FREE_MODEL_NAME or "google/gemini-3.8-flash",
            temperature=0.2,
            fallback_provider="openrouter",
            fallback_model=settings.OPENROUTER_FALLBACK_MODEL,
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
                    try:
                        provider = self.resolve_provider(row.base_url, row.provider_name)
                        self.validate_model(row.model, provider)
                    except ValueError:
                        logger.warning("[llm_config] Ignoring unsupported persisted route for tier %s", row.tier)
                        continue
                    fallback_model = row.fallback_model or ""
                    try:
                        if row.fallback_provider != "openrouter":
                            raise ValueError("Unsupported fallback")
                        self.validate_model(fallback_model, "openrouter")
                    except ValueError:
                        fallback_model = settings.OPENROUTER_FALLBACK_MODEL
                    self._cache[row.tier] = TierConfig(
                        tier=row.tier,
                        provider_name=row.provider_name,
                        base_url=row.base_url,
                        model=row.model,
                        temperature=row.temperature,
                        fallback_provider="openrouter",
                        fallback_model=fallback_model,
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
            logger.warning("Could not load LLMProviderConfig from DB (%s)", type(exc).__name__)
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
        fallback_provider: str | None = "openrouter",
        fallback_model: str | None = settings.OPENROUTER_FALLBACK_MODEL,
        extra_headers: dict[str, str] | None = None,
    ) -> TierConfig:
        tier_key = "pro" if tier.lower() in ("pro", "true") else "free"
        cleaned_url = base_url.strip()
        cleaned_model = model.strip()

        resolved_provider = self.resolve_provider(cleaned_url, provider_name)
        self.validate_model(cleaned_model, resolved_provider)
        if fallback_provider != "openrouter":
            raise ValueError("Fallback must use OpenRouter")
        self.validate_model(fallback_model or "", "openrouter")

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

    @staticmethod
    def resolve_provider(base_url: str, provider_name: str | None = None) -> str:
        url = urlsplit(base_url)
        if url.scheme not in ("http", "https") or url.username or url.password or url.query or url.fragment:
            raise ValueError("Invalid AI route URL")
        if url.hostname == "openrouter.ai" and url.scheme == "https" and url.path.rstrip("/") == "/api/v1":
            return "openrouter"
        # OmniRoute may be self-hosted, but its endpoint must be explicitly configured.
        configured = urlsplit(settings.PRO_MODEL_BASE_URL)
        def api_path(path: str) -> str:
            return path.rstrip("/") or "/v1"
        if (url.scheme, url.netloc, api_path(url.path)) == (configured.scheme, configured.netloc, api_path(configured.path)) and provider_name in (None, "omniroute"):
            return "omniroute"
        raise ValueError("Only configured OmniRoute and OpenRouter routes are supported")

    @staticmethod
    def validate_model(model: str, provider: str) -> None:
        pattern = r"google/gemini-[a-z0-9.\-]+" if provider == "openrouter" else r"gemini-[a-z0-9.\-]+"
        if not re.fullmatch(pattern, model):
            raise ValueError("Only explicit Gemini text model IDs are supported")
        if any(part in model for part in ("image", "nano-banana")):
            raise ValueError("A Gemini text model is required")

    def create_client(self, cfg: TierConfig, api_key_override: str | None = None) -> ChatOpenAI:
        provider = self.resolve_provider(cfg.base_url, cfg.provider_name)
        self.validate_model(cfg.model, provider)
        if not cfg.is_active:
            raise ApiKeyUnavailable("AI route is inactive")
        pool = openrouter_pool if provider == "openrouter" else pro_pool
        key = api_key_override or pool.next()
        headers = {"HTTP-Referer": settings.FRONTEND_URL, "X-Title": "Resumer"} if provider == "openrouter" else {}
        headers.update(cfg.extra_headers)
        if any(k.lower() in ("authorization", "host", "x-api-key") for k in headers):
            raise ValueError("Credential headers must come from the route key pool")
        llm = ChatOpenAI(model=cfg.model, temperature=cfg.temperature, max_retries=0,
                         timeout=40, max_tokens=settings.LLM_MAX_OUTPUT_TOKENS,
                         base_url=cfg.base_url.rstrip("/"), api_key=key,
                         default_headers=headers or None)
        object.__setattr__(llm, "_credential_owner", None if api_key_override else (pool, key))
        object.__setattr__(llm, "_route_provider", provider)
        return llm

    def get_llm(self, tier: str = "free", api_key_override: str | None = None) -> ChatOpenAI:
        return self.create_client(self.get_tier_config(tier), api_key_override)

    def get_fallback_llm(self, tier: str = "free", api_key_override: str | None = None) -> ChatOpenAI:
        cfg = self.get_tier_config(tier)
        if cfg.fallback_provider != "openrouter":
            raise ValueError("Fallback must use OpenRouter")
        return self.create_client(TierConfig(tier=cfg.tier, provider_name="openrouter",
            base_url="https://openrouter.ai/api/v1", model=cfg.fallback_model or "",
            temperature=cfg.temperature), api_key_override)

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
                    fallback_provider VARCHAR DEFAULT 'openrouter',
                    fallback_model VARCHAR DEFAULT 'google/gemini-3.8-flash',
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
