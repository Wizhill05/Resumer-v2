"""Admin-managed OpenAI-compatible endpoints and role routing."""
from __future__ import annotations

import asyncio
import logging
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Any

from langchain_openai import ChatOpenAI
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.secrets import SecretDecryptError, decrypt_secret, encrypt_secret, secret_hint
from src.models.llm import LlmEndpoint, LlmRoleAssignment
from src.services import llm_probe
from src.services.llm_probe import ProbeError

logger = logging.getLogger(__name__)

ROLE_IDS = ("default", "pro", "utility", "audio")

ROLE_CATALOG: dict[str, dict] = {
    "default": {
        "label": "Resume generation",
        "description": "Every pipeline node for non-Pro users, the resume retailor, and the prompt playground/bulk test.",
        "used_for": ["Resume generation", "Resume retailor", "Prompt playground", "Bulk prompt test"],
        "required": True,
        "inherits_from": None,
    },
    "pro": {
        "label": "Resume generation (Pro)",
        "description": "Every pipeline node when is_pro is set.",
        "used_for": ["Resume generation (Pro)"],
        "required": False,
        "inherits_from": "default",
    },
    "utility": {
        "label": "Imports & support triage",
        "description": "Resume import, GitHub import, and support summarization.",
        "used_for": ["Resume import", "GitHub import", "Support summarization"],
        "required": False,
        "inherits_from": "default",
    },
    "audio": {
        "label": "Voice transcription",
        "description": "Support voice transcription. When empty, transcription is skipped.",
        "used_for": ["Voice transcription"],
        "required": False,
        "inherits_from": None,
    },
}

MAX_TARGETS_PER_ROLE = 3
COOLDOWN_SECONDS = 60.0


class InferenceExhausted(RuntimeError):
    pass


class LLMNotConfigured(InferenceExhausted):
    def __init__(self, role: str):
        super().__init__(
            f"No LLM endpoint is configured for '{role}'. Configure one in Admin → LLM Endpoints."
        )
        self.role = role


class FieldError(ValueError):
    """A ValueError that points at the offending request field (surfaced as 422 `field`)."""

    def __init__(self, message: str, field: str | None = None):
        super().__init__(message)
        self.field = field


class ConflictError(Exception):
    def __init__(self, code: str, message: str, roles: list[str] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.roles = roles


@dataclass(frozen=True)
class EndpointRuntime:
    id: str
    name: str
    base_url: str
    api_key: str | None
    api_key_status: str
    extra_headers: dict
    extra_body: dict
    structured_output_mode: str
    timeout_seconds: float
    max_retries: int
    default_temperature: float
    max_output_tokens: int | None
    enabled: bool


@dataclass(frozen=True)
class ResolvedTarget:
    endpoint: EndpointRuntime
    model: str
    temperature: float
    max_output_tokens: int
    inherited: bool


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class LLMConfigService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._endpoints: dict[str, EndpointRuntime] = {}
        self._role_targets: dict[str, list[dict]] = {role: [] for role in ROLE_IDS}
        self._role_overrides: dict[str, dict] = {role: {"temperature": None, "max_output_tokens": None} for role in ROLE_IDS}
        self._loaded_at = 0.0
        self._cooldowns: dict[str, float] = {}

    # ── runtime snapshot ────────────────────────────────────────────────
    async def load_from_db(self, db: AsyncSession | None = None) -> None:
        from src.core.database import AsyncSessionLocal

        async def _load(session: AsyncSession) -> None:
            endpoints_result = await session.execute(select(LlmEndpoint))
            endpoint_rows = endpoints_result.scalars().all()
            roles_result = await session.execute(select(LlmRoleAssignment))
            role_rows = roles_result.scalars().all()

            endpoints: dict[str, EndpointRuntime] = {}
            for row in endpoint_rows:
                api_key: str | None = None
                api_key_status = "missing"
                if row.api_key_encrypted:
                    try:
                        api_key = decrypt_secret(row.api_key_encrypted)
                        api_key_status = "ok"
                    except SecretDecryptError:
                        api_key = None
                        api_key_status = "undecryptable"
                    except Exception:
                        api_key = None
                        api_key_status = "undecryptable"
                endpoints[str(row.id)] = EndpointRuntime(
                    id=str(row.id),
                    name=row.name,
                    base_url=row.base_url,
                    api_key=api_key,
                    api_key_status=api_key_status,
                    extra_headers=row.extra_headers or {},
                    extra_body=row.extra_body or {},
                    structured_output_mode=row.structured_output_mode or "json_schema",
                    timeout_seconds=row.timeout_seconds or 60.0,
                    max_retries=row.max_retries if row.max_retries is not None else 1,
                    default_temperature=row.default_temperature if row.default_temperature is not None else 0.2,
                    max_output_tokens=row.max_output_tokens,
                    enabled=bool(row.enabled),
                )

            role_targets: dict[str, list[dict]] = {role: [] for role in ROLE_IDS}
            role_overrides: dict[str, dict] = {
                role: {"temperature": None, "max_output_tokens": None} for role in ROLE_IDS
            }
            for row in role_rows:
                if row.role not in role_targets:
                    continue
                role_targets[row.role] = list(row.targets or [])
                role_overrides[row.role] = {
                    "temperature": row.temperature,
                    "max_output_tokens": row.max_output_tokens,
                }

            with self._lock:
                self._endpoints = endpoints
                self._role_targets = role_targets
                self._role_overrides = role_overrides
                self._loaded_at = time.monotonic()

        try:
            if db is not None:
                await _load(db)
            else:
                async with AsyncSessionLocal() as session:
                    await _load(session)
        except Exception as exc:
            logger.warning("[llm_config] Could not load LLM config from DB (%s)", type(exc).__name__)
            if db is not None:
                try:
                    await db.rollback()
                except Exception:
                    pass

    async def ensure_fresh(self) -> None:
        if time.monotonic() - self._loaded_at > (settings.LLM_CONFIG_REFRESH_SECONDS or 30):
            await self.load_from_db()

    def _resolve_role_targets(
        self,
        role: str,
        endpoints: dict[str, EndpointRuntime],
        role_targets: dict[str, list[dict]],
        role_overrides: dict[str, dict],
        cooldowns: dict[str, float],
    ) -> list[ResolvedTarget]:
        if role not in ROLE_IDS:
            raise LookupError(f"Unknown role {role!r}")
        stored = list(role_targets.get(role) or [])
        inherited = False
        if not stored and ROLE_CATALOG[role]["inherits_from"]:
            parent = ROLE_CATALOG[role]["inherits_from"]
            stored = list(role_targets.get(parent) or [])
            inherited = True
            overrides = role_overrides.get(role) or {"temperature": None, "max_output_tokens": None}
        else:
            overrides = role_overrides.get(role) or {"temperature": None, "max_output_tokens": None}

        resolved: list[ResolvedTarget] = []
        seen: set[tuple[str, str]] = set()
        for entry in stored:
            endpoint_id = str(entry.get("endpoint_id") or "")
            model = str(entry.get("model") or "").strip()
            if not endpoint_id or not model:
                continue
            key = (endpoint_id, model)
            if key in seen:
                continue
            seen.add(key)
            endpoint = endpoints.get(endpoint_id)
            if endpoint is None:
                continue
            if not endpoint.enabled:
                continue
            if endpoint.api_key_status == "undecryptable":
                continue
            temperature = overrides.get("temperature")
            if temperature is None:
                temperature = endpoint.default_temperature
            max_output_tokens = overrides.get("max_output_tokens")
            if max_output_tokens is None:
                max_output_tokens = endpoint.max_output_tokens
            if max_output_tokens is None:
                max_output_tokens = settings.LLM_MAX_OUTPUT_TOKENS
            resolved.append(
                ResolvedTarget(
                    endpoint=endpoint,
                    model=model,
                    temperature=float(temperature),
                    max_output_tokens=int(max_output_tokens),
                    inherited=inherited,
                )
            )

        now = time.monotonic()
        fresh = [t for t in resolved if cooldowns.get(t.endpoint.id, 0.0) <= now]
        cooling = [t for t in resolved if cooldowns.get(t.endpoint.id, 0.0) > now]
        if cooling and not fresh:
            return resolved
        return fresh + cooling

    def resolve_targets(self, role: str) -> list[ResolvedTarget]:
        with self._lock:
            endpoints = dict(self._endpoints)
            role_targets = {k: list(v) for k, v in self._role_targets.items()}
            role_overrides = {k: dict(v) for k, v in self._role_overrides.items()}
            cooldowns = dict(self._cooldowns)
        return self._resolve_role_targets(role, endpoints, role_targets, role_overrides, cooldowns)

    def describe_primary(self, role: str) -> str:
        targets = self.resolve_targets(role)
        if not targets:
            return "unconfigured"
        first = targets[0]
        return f"{first.endpoint.name}/{first.model}"

    def build_client(self, target: ResolvedTarget) -> ChatOpenAI:
        endpoint = target.endpoint
        llm = ChatOpenAI(
            model=target.model,
            base_url=endpoint.base_url,
            api_key=endpoint.api_key or "not-needed",
            temperature=target.temperature,
            max_tokens=target.max_output_tokens,
            max_retries=0,
            timeout=endpoint.timeout_seconds,
            default_headers=endpoint.extra_headers or None,
            extra_body=endpoint.extra_body or None,
        )
        object.__setattr__(llm, "_endpoint_id", endpoint.id)
        object.__setattr__(llm, "_endpoint_name", endpoint.name)
        object.__setattr__(llm, "_structured_mode", endpoint.structured_output_mode)
        return llm

    def mark_cooldown(self, endpoint_id: str) -> None:
        with self._lock:
            self._cooldowns[str(endpoint_id)] = time.monotonic() + COOLDOWN_SECONDS

    def cooldown_until(self, endpoint_id: str) -> datetime | None:
        with self._lock:
            remaining = self._cooldowns.get(str(endpoint_id), 0.0) - time.monotonic()
        if remaining <= 0:
            return None
        return datetime.now(timezone.utc) + timedelta(seconds=remaining)

    # ── admin-facing helpers ────────────────────────────────────────────
    def _decrypt_for_row(self, row: LlmEndpoint) -> tuple[str | None, str]:
        if not row.api_key_encrypted:
            return None, "missing"
        try:
            return decrypt_secret(row.api_key_encrypted), "ok"
        except (SecretDecryptError, Exception):
            return None, "undecryptable"

    def _endpoint_out(self, row: LlmEndpoint, used_by_roles: list[str] | None = None) -> dict:
        _, api_key_status = self._decrypt_for_row(row)
        has_api_key = bool(row.api_key_encrypted)
        if not has_api_key:
            api_key_status = "missing"
        health_error = row.last_check_error
        return {
            "id": str(row.id),
            "name": row.name,
            "base_url": row.base_url,
            "has_api_key": has_api_key,
            "api_key_hint": row.api_key_hint,
            "api_key_status": api_key_status,
            "extra_headers": row.extra_headers or {},
            "extra_body": row.extra_body or {},
            "structured_output_mode": row.structured_output_mode or "json_schema",
            "timeout_seconds": float(row.timeout_seconds or 60.0),
            "max_retries": int(row.max_retries if row.max_retries is not None else 1),
            "default_temperature": float(row.default_temperature if row.default_temperature is not None else 0.2),
            "max_output_tokens": row.max_output_tokens,
            "enabled": bool(row.enabled),
            "default_model": row.default_model,
            "models": list(row.models_cache or []),
            "models_fetched_at": _iso(row.models_fetched_at),
            "health": {
                "status": row.last_check_status or "unknown",
                "checked_at": _iso(row.last_check_at),
                "latency_ms": row.last_check_latency_ms,
                "error": health_error,
                "cooldown_until": _iso(self.cooldown_until(str(row.id))),
            },
            "used_by_roles": list(used_by_roles or []),
            "created_at": _iso(row.created_at) or _iso(datetime.now(timezone.utc)),
            "updated_at": _iso(row.updated_at) or _iso(datetime.now(timezone.utc)),
        }

    async def list_config(self, db) -> dict:
        endpoints_result = await db.execute(select(LlmEndpoint).order_by(LlmEndpoint.name))
        endpoint_rows = list(endpoints_result.scalars().all())
        roles_result = await db.execute(select(LlmRoleAssignment))
        role_rows = {row.role: row for row in roles_result.scalars().all()}

        endpoints_by_id: dict[str, LlmEndpoint] = {str(row.id): row for row in endpoint_rows}
        used_by: dict[str, list[str]] = {str(row.id): [] for row in endpoint_rows}
        stored_targets: dict[str, list[dict]] = {}
        for role in ROLE_IDS:
            row = role_rows.get(role)
            targets = list(row.targets or []) if row else []
            stored_targets[role] = targets
            for entry in targets:
                endpoint_id = str(entry.get("endpoint_id") or "")
                if endpoint_id in used_by and role not in used_by[endpoint_id]:
                    used_by[endpoint_id].append(role)

        # Build runtime-shaped view for effective targets / issues
        runtime_endpoints: dict[str, EndpointRuntime] = {}
        for row in endpoint_rows:
            api_key, status = self._decrypt_for_row(row)
            runtime_endpoints[str(row.id)] = EndpointRuntime(
                id=str(row.id),
                name=row.name,
                base_url=row.base_url,
                api_key=api_key,
                api_key_status=status,
                extra_headers=row.extra_headers or {},
                extra_body=row.extra_body or {},
                structured_output_mode=row.structured_output_mode or "json_schema",
                timeout_seconds=row.timeout_seconds or 60.0,
                max_retries=row.max_retries if row.max_retries is not None else 1,
                default_temperature=row.default_temperature if row.default_temperature is not None else 0.2,
                max_output_tokens=row.max_output_tokens,
                enabled=bool(row.enabled),
            )
        role_overrides: dict[str, dict] = {}
        for role in ROLE_IDS:
            row = role_rows.get(role)
            role_overrides[role] = {
                "temperature": row.temperature if row else None,
                "max_output_tokens": row.max_output_tokens if row else None,
            }
        with self._lock:
            cooldowns = dict(self._cooldowns)

        roles_out: list[dict] = []
        for role in ROLE_IDS:
            catalog = ROLE_CATALOG[role]
            row = role_rows.get(role)
            stored = stored_targets[role]
            effective = self._resolve_role_targets(
                role, runtime_endpoints, stored_targets, role_overrides, cooldowns
            )
            effective_out = [
                {
                    "endpoint_id": target.endpoint.id,
                    "model": target.model,
                    "endpoint_name": target.endpoint.name,
                    "endpoint_enabled": target.endpoint.enabled,
                    "inherited": target.inherited,
                }
                for target in effective
            ]
            issues: list[str] = []
            if not stored:
                if catalog["inherits_from"]:
                    parent_label = ROLE_CATALOG[catalog["inherits_from"]]["label"]
                    issues.append(f"Inheriting from {parent_label}")
                else:
                    issues.append("No targets configured")
            for entry in stored:
                endpoint_id = str(entry.get("endpoint_id") or "")
                model_name = str(entry.get("model") or "")
                endpoint_row = endpoints_by_id.get(endpoint_id)
                if endpoint_row is None:
                    continue
                if not endpoint_row.enabled:
                    issues.append(f"Endpoint '{endpoint_row.name}' is disabled")
                _, status = self._decrypt_for_row(endpoint_row)
                if status == "undecryptable":
                    issues.append(f"Endpoint '{endpoint_row.name}' token cannot be decrypted — re-enter it")
                catalog_models = endpoint_row.models_cache or []
                if catalog_models and model_name:
                    known_ids = {str(m.get("id")) for m in catalog_models if isinstance(m, dict)}
                    if model_name not in known_ids:
                        issues.append(f"Model '{model_name}' not in '{endpoint_row.name}' catalog")
            roles_out.append(
                {
                    "role": role,
                    "label": catalog["label"],
                    "description": catalog["description"],
                    "used_for": list(catalog["used_for"]),
                    "required": bool(catalog["required"]),
                    "inherits_from": catalog["inherits_from"],
                    "targets": [{"endpoint_id": str(t.get("endpoint_id") or ""), "model": str(t.get("model") or "")} for t in stored],
                    "effective_targets": effective_out,
                    "temperature": row.temperature if row else None,
                    "max_output_tokens": row.max_output_tokens if row else None,
                    "issues": issues,
                    "updated_at": _iso(row.updated_at) if row else None,
                }
            )

        default_effective = self._resolve_role_targets(
            "default", runtime_endpoints, stored_targets, role_overrides, cooldowns
        )
        ready = len(default_effective) > 0
        endpoints_out = [self._endpoint_out(row, used_by.get(str(row.id), [])) for row in endpoint_rows]

        return {
            "ready": ready,
            "endpoints": endpoints_out,
            "roles": roles_out,
            "limits": {"max_targets_per_role": MAX_TARGETS_PER_ROLE, "max_extra_headers": 20},
            "server_defaults": {"max_output_tokens": int(settings.LLM_MAX_OUTPUT_TOKENS)},
        }

    async def _get_endpoint_row(self, db, endpoint_id: uuid.UUID) -> LlmEndpoint:
        result = await db.execute(select(LlmEndpoint).where(LlmEndpoint.id == endpoint_id))
        row = result.scalar_one_or_none()
        if row is None:
            raise LookupError(f"Endpoint {endpoint_id} not found")
        return row

    def _persist_health(self, row: LlmEndpoint, ok: bool, latency_ms: float | None, error: dict | None) -> None:
        row.last_check_status = "ok" if ok else "error"
        row.last_check_at = datetime.now(timezone.utc)
        row.last_check_latency_ms = latency_ms
        row.last_check_error = None if ok else error

    async def create_endpoint(self, db, data) -> dict:
        try:
            normalized = llm_probe.normalize_base_url(data.base_url)
        except ProbeError as exc:
            raise FieldError(exc.message, "base_url") from exc

        name = (data.name or "").strip() or llm_probe.suggest_name(normalized)
        explicit_name = (data.name or "").strip() != ""
        existing = (await db.execute(select(LlmEndpoint.name))).scalars().all()
        existing_names = set(existing)
        if explicit_name and name in existing_names:
            raise ConflictError("duplicate_name", f"An endpoint named {name!r} already exists.")
        if not explicit_name and name in existing_names:
            suffix = 2
            while f"{name} {suffix}" in existing_names:
                suffix += 1
            name = f"{name} {suffix}"

        api_key = (data.api_key or "").strip() or None
        encrypted = encrypt_secret(api_key) if api_key else None
        hint = secret_hint(api_key) if api_key else None

        row = LlmEndpoint(
            name=name,
            base_url=normalized,
            api_key_encrypted=encrypted,
            api_key_hint=hint,
            extra_headers=data.extra_headers or {},
            extra_body=data.extra_body or {},
            structured_output_mode=data.structured_output_mode,
            timeout_seconds=float(data.timeout_seconds),
            max_retries=int(data.max_retries),
            default_temperature=float(data.default_temperature),
            max_output_tokens=data.max_output_tokens,
            enabled=bool(data.enabled),
            default_model=data.default_model,
            models_cache=[],
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)

        # Best-effort models fetch (bounded timeout, never fails creation).
        try:
            result = await llm_probe.fetch_models(
                normalized, api_key, row.extra_headers or {}, timeout=10.0
            )
            if result.get("ok"):
                row.models_cache = list(result.get("models") or [])
                row.models_fetched_at = datetime.now(timezone.utc)
                if not row.default_model:
                    row.default_model = llm_probe.suggest_model(row.models_cache)
                self._persist_health(row, True, result.get("latency_ms"), None)
            else:
                error = result.get("error") or {"code": "http_error", "message": "Could not fetch models.", "status_code": None}
                self._persist_health(row, False, result.get("latency_ms"), error)
            await db.commit()
            await db.refresh(row)
        except Exception as exc:
            logger.warning("[llm_config] create_endpoint models fetch failed (%s)", type(exc).__name__)

        await self.load_from_db(db)
        return self._endpoint_out(row, [])

    async def update_endpoint(self, db, endpoint_id: uuid.UUID, data) -> dict:
        row = await self._get_endpoint_row(db, endpoint_id)
        fields = data.model_fields_set

        if "name" in fields and data.name is not None and not str(data.name).strip():
            raise FieldError("Name cannot be blank.", "name")
        if "base_url" in fields and data.base_url is not None and not str(data.base_url).strip():
            raise FieldError("Base URL cannot be blank.", "base_url")

        if "name" in fields and data.name is not None and str(data.name).strip():
            new_name = str(data.name).strip()
            if new_name != row.name:
                clash = await db.execute(
                    select(LlmEndpoint).where(LlmEndpoint.name == new_name, LlmEndpoint.id != endpoint_id)
                )
                if clash.scalar_one_or_none() is not None:
                    raise ConflictError("duplicate_name", f"An endpoint named {new_name!r} already exists.")
                row.name = new_name

        base_url_changed = False
        if "base_url" in fields and data.base_url is not None and str(data.base_url).strip():
            try:
                normalized = llm_probe.normalize_base_url(str(data.base_url))
            except ProbeError as exc:
                raise FieldError(exc.message, "base_url") from exc
            if normalized != row.base_url:
                row.base_url = normalized
                base_url_changed = True

        credentials_changed = False
        if "api_key" in fields and data.api_key is not None and str(data.api_key).strip():
            credentials_changed = True
            plaintext = str(data.api_key).strip()
            row.api_key_encrypted = encrypt_secret(plaintext)
            row.api_key_hint = secret_hint(plaintext)
        elif getattr(data, "clear_api_key", False):
            credentials_changed = True
            row.api_key_encrypted = None
            row.api_key_hint = None

        if "extra_headers" in fields and data.extra_headers is not None:
            if data.extra_headers != (row.extra_headers or {}):
                credentials_changed = True
            row.extra_headers = data.extra_headers
        if "extra_body" in fields and data.extra_body is not None:
            row.extra_body = data.extra_body
        if "structured_output_mode" in fields and data.structured_output_mode is not None:
            row.structured_output_mode = data.structured_output_mode
        if "timeout_seconds" in fields and data.timeout_seconds is not None:
            row.timeout_seconds = float(data.timeout_seconds)
        if "max_retries" in fields and data.max_retries is not None:
            row.max_retries = int(data.max_retries)
        if "default_temperature" in fields and data.default_temperature is not None:
            row.default_temperature = float(data.default_temperature)
        if "max_output_tokens" in fields:
            row.max_output_tokens = data.max_output_tokens
        if "enabled" in fields and data.enabled is not None:
            row.enabled = bool(data.enabled)
        if "default_model" in fields:
            row.default_model = data.default_model

        if credentials_changed and not base_url_changed:
            row.last_check_status = None
            row.last_check_at = None
            row.last_check_latency_ms = None
            row.last_check_error = None
        if base_url_changed:
            row.models_cache = []
            row.models_fetched_at = None
            row.last_check_status = None
            row.last_check_at = None
            row.last_check_latency_ms = None
            row.last_check_error = None

        await db.commit()
        await db.refresh(row)
        await self.load_from_db(db)

        roles_result = await db.execute(select(LlmRoleAssignment))
        used = []
        for role_row in roles_result.scalars().all():
            for entry in role_row.targets or []:
                if str(entry.get("endpoint_id") or "") == str(endpoint_id):
                    if role_row.role not in used:
                        used.append(role_row.role)
                    break
        return self._endpoint_out(row, sorted(used, key=lambda r: ROLE_IDS.index(r) if r in ROLE_IDS else 99))

    async def delete_endpoint(self, db, endpoint_id, force: bool) -> list[str]:
        row = await self._get_endpoint_row(db, endpoint_id)
        roles_result = await db.execute(select(LlmRoleAssignment))
        role_rows = list(roles_result.scalars().all())
        used_roles: list[str] = []
        for role_row in role_rows:
            for entry in role_row.targets or []:
                if str(entry.get("endpoint_id") or "") == str(endpoint_id):
                    if role_row.role not in used_roles:
                        used_roles.append(role_row.role)
                    break
        ordered = sorted(used_roles, key=lambda r: ROLE_IDS.index(r) if r in ROLE_IDS else 99)
        if ordered and not force:
            raise ConflictError(
                "endpoint_in_use",
                "This endpoint is used by one or more roles. Use force to delete it anyway.",
                roles=ordered,
            )
        if force:
            for role_row in role_rows:
                targets = role_row.targets or []
                filtered = [t for t in targets if str(t.get("endpoint_id") or "") != str(endpoint_id)]
                if len(filtered) != len(targets):
                    role_row.targets = filtered
        await db.delete(row)
        await db.commit()
        await self.load_from_db(db)
        return ordered

    async def refresh_models(self, db, endpoint_id) -> dict:
        row = await self._get_endpoint_row(db, endpoint_id)
        api_key, status = self._decrypt_for_row(row)
        if status == "undecryptable":
            error = {"code": "undecryptable_api_key", "message": "The stored token cannot be decrypted. Re-enter it.", "status_code": None}
            self._persist_health(row, False, None, error)
            await db.commit()
            await self.load_from_db(db)
            return {"ok": False, "models": list(row.models_cache or []), "models_fetched_at": _iso(row.models_fetched_at), "error": error}
        result = await llm_probe.fetch_models(row.base_url, api_key, row.extra_headers or {}, timeout=15.0)
        if result.get("ok"):
            row.models_cache = list(result.get("models") or [])
            row.models_fetched_at = datetime.now(timezone.utc)
            self._persist_health(row, True, result.get("latency_ms"), None)
            await db.commit()
            await db.refresh(row)
            await self.load_from_db(db)
            return {
                "ok": True,
                "models": list(row.models_cache or []),
                "models_fetched_at": _iso(row.models_fetched_at),
                "error": None,
            }
        error = result.get("error") or {"code": "http_error", "message": "Could not fetch models.", "status_code": None}
        self._persist_health(row, False, result.get("latency_ms"), error)
        await db.commit()
        await self.load_from_db(db)
        return {"ok": False, "models": list(row.models_cache or []), "models_fetched_at": _iso(row.models_fetched_at), "error": error}

    async def test_endpoint(self, db, endpoint_id, model: str | None, prompt: str | None) -> dict:
        row = await self._get_endpoint_row(db, endpoint_id)
        api_key, status = self._decrypt_for_row(row)
        if status == "undecryptable":
            error = {"code": "undecryptable_api_key", "message": "The stored token cannot be decrypted. Re-enter it.", "status_code": None}
            self._persist_health(row, False, None, error)
            await db.commit()
            await self.load_from_db(db)
            return {"ok": False, "model": model or row.default_model, "latency_ms": None, "output": None, "usage": None, "error": error}
        effective_model = (model or "").strip() or row.default_model
        if not effective_model:
            error = {"code": "completion_failed", "message": "No model specified and the endpoint has no default model.", "status_code": None}
            self._persist_health(row, False, None, error)
            await db.commit()
            await self.load_from_db(db)
            return {"ok": False, "model": None, "latency_ms": None, "output": None, "usage": None, "error": error}
        result = await llm_probe.run_test_completion(
            row.base_url,
            api_key,
            row.extra_headers or {},
            row.extra_body or {},
            effective_model,
            prompt,
            timeout=float(row.timeout_seconds or 60.0),
        )
        if result.get("ok"):
            self._persist_health(row, True, result.get("latency_ms"), None)
        else:
            self._persist_health(row, False, result.get("latency_ms"), result.get("error"))
        await db.commit()
        await self.load_from_db(db)
        return {
            "ok": bool(result.get("ok")),
            "model": effective_model,
            "latency_ms": result.get("latency_ms"),
            "output": result.get("output"),
            "usage": result.get("usage"),
            "error": result.get("error"),
        }

    async def probe(self, db, req) -> dict:
        api_key: str | None = (req.api_key or "").strip() or None
        endpoint_id_str: str | None = getattr(req, "endpoint_id", None)
        endpoint_row: LlmEndpoint | None = None
        if endpoint_id_str:
            try:
                endpoint_uuid = uuid.UUID(str(endpoint_id_str))
            except (ValueError, TypeError) as exc:
                raise LookupError(f"Endpoint {endpoint_id_str} not found") from exc
            endpoint_row = await self._get_endpoint_row(db, endpoint_uuid)
            if api_key is None:
                api_key, status = self._decrypt_for_row(endpoint_row)
                if status == "undecryptable":
                    return {
                        "ok": False,
                        "normalized_base_url": None,
                        "models_url": None,
                        "latency_ms": None,
                        "models": [],
                        "suggested_model": None,
                        "suggested_name": llm_probe.suggest_name(endpoint_row.base_url),
                        "structured_output": None,
                        "attempts": [],
                        "error": {"code": "undecryptable_api_key", "message": "The stored token cannot be decrypted. Re-enter it.", "status_code": None},
                    }
        # Prefer the stored base_url when the request did not supply one explicitly.
        # The contract always sends base_url, so fall back to request value.
        base_url = (req.base_url or "").strip() or (endpoint_row.base_url if endpoint_row else "")
        extra_headers = dict(req.extra_headers or {})
        if endpoint_row is not None and not req.extra_headers:
            # If caller did not supply headers and we have stored ones, do not leak
            # stored headers into a probe against a possibly different URL.
            extra_headers = {}

        timeout = float(req.timeout_seconds or 15.0)
        result = await llm_probe.fetch_models(base_url, api_key, extra_headers, timeout=timeout)
        suggested_name = llm_probe.suggest_name(result.get("normalized_base_url") or base_url)

        structured: dict | None = None
        if result.get("ok") and req.probe_model:
            detection = await llm_probe.detect_structured_output(
                result["normalized_base_url"],
                api_key,
                extra_headers,
                endpoint_row.extra_body if endpoint_row else {},
                req.probe_model,
                timeout=timeout,
            )
            structured = {"mode": detection["mode"], "checks": detection["checks"]}

        return {
            "ok": bool(result.get("ok")),
            "normalized_base_url": result.get("normalized_base_url"),
            "models_url": result.get("models_url"),
            "latency_ms": result.get("latency_ms"),
            "models": list(result.get("models") or []),
            "suggested_model": llm_probe.suggest_model(list(result.get("models") or [])) if result.get("ok") else None,
            "suggested_name": suggested_name,
            "structured_output": structured,
            "attempts": list(result.get("attempts") or []),
            "error": result.get("error"),
        }

    async def update_role(self, db, role: str, data) -> dict:
        if role not in ROLE_IDS:
            raise LookupError(f"Unknown role {role!r}")
        targets = [{"endpoint_id": str(t.endpoint_id), "model": str(t.model)} for t in (data.targets or [])]
        endpoint_ids = {t["endpoint_id"] for t in targets}
        if endpoint_ids:
            result = await db.execute(select(LlmEndpoint.id).where(LlmEndpoint.id.in_([uuid.UUID(i) for i in endpoint_ids])))
            found = {str(r) for r in result.scalars().all()}
            missing = endpoint_ids - found
            if missing:
                raise FieldError(f"Unknown endpoint id(s): {', '.join(sorted(missing))}", "targets")
        result = await db.execute(select(LlmRoleAssignment).where(LlmRoleAssignment.role == role))
        row = result.scalar_one_or_none()
        if row is None:
            row = LlmRoleAssignment(role=role, targets=targets, temperature=data.temperature, max_output_tokens=data.max_output_tokens)
            db.add(row)
        else:
            row.targets = targets
            row.temperature = data.temperature
            row.max_output_tokens = data.max_output_tokens
        await db.commit()
        await self.load_from_db(db)
        return await self.list_config(db)

    async def status_summary(self, db) -> dict:
        config = await self.list_config(db)
        roles = {r["role"]: r for r in config["roles"]}
        endpoints_total = len(config["endpoints"])
        endpoints_enabled = sum(1 for e in config["endpoints"] if e["enabled"])

        def _primary(role_id: str):
            effective = roles.get(role_id, {}).get("effective_targets") or []
            if not effective:
                return None
            first = effective[0]
            return {"endpoint_name": first["endpoint_name"], "model": first["model"]}

        return {
            "ready": bool(config["ready"]),
            "endpoints_total": endpoints_total,
            "endpoints_enabled": endpoints_enabled,
            "default_primary": _primary("default"),
            "pro_primary": _primary("pro"),
        }

    async def bootstrap_from_env(self, db) -> None:
        existing = (await db.execute(select(LlmEndpoint.id).limit(1))).scalar_one_or_none()
        if existing is not None:
            return
        base_url_raw = (settings.LLM_BOOTSTRAP_BASE_URL or "").strip()
        model = (settings.LLM_BOOTSTRAP_MODEL or "").strip()
        if not base_url_raw or not model:
            return
        try:
            base_url = llm_probe.normalize_base_url(base_url_raw)
        except ProbeError:
            return
        api_key = (settings.LLM_BOOTSTRAP_API_KEY or "").strip() or None
        row = LlmEndpoint(
            name=(settings.LLM_BOOTSTRAP_NAME or "Primary").strip() or "Primary",
            base_url=base_url,
            api_key_encrypted=encrypt_secret(api_key) if api_key else None,
            api_key_hint=secret_hint(api_key) if api_key else None,
            default_model=model,
            models_cache=[],
        )
        db.add(row)
        await db.flush()
        result = await db.execute(select(LlmRoleAssignment).where(LlmRoleAssignment.role == "default"))
        role_row = result.scalar_one_or_none()
        target = [{"endpoint_id": str(row.id), "model": model}]
        if role_row is None:
            db.add(LlmRoleAssignment(role="default", targets=target))
        else:
            if not (role_row.targets or []):
                role_row.targets = target
        await db.commit()


async def ensure_llm_schema() -> None:
    from src.core.database import engine

    try:
        async with engine.begin() as conn:
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_pro BOOLEAN NOT NULL DEFAULT false;"))
    except Exception as exc:
        logger.warning("[llm_config/startup] ensure_llm_schema warning: %s", exc)


llm_config_service = LLMConfigService()
