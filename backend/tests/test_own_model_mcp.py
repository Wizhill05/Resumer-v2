import asyncio
import json
import sqlite3
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from threading import Event
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from urllib.parse import parse_qs, urlsplit

import pytest
from httpx import ASGITransport, AsyncClient
from jose import jwt
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.sql.dml import Update
from sqlalchemy.types import ARRAY

from src.api import generation as generation_api
from src.core.auth import get_optional_user
from src.core.config import settings
from src.core.database import get_db
from src.core.file_links import build_resume_file_link
from src.core.oauth import create_oauth_access_token, hash_token
from src.core.storage import StorageService
from src.main import app
from src.mcp.context import reset_current_mcp_user, set_current_mcp_user
from src.mcp.tools import client_generation, editor, generation, inference_mode
from src.models.generation import (
    Generation, GenerationLog, GenerationNodeMetric, SupportRateLimit, UserCreditOverride, UserRateLimit,
)
from src.models.profile import Profile, UserEducation, UserExperience, UserExtracurricular, UserProject
from src.models.user import AccountCleanupTask, Base, InferenceModeChallenge, User
from src.pipeline import job_runner
from src.services import client_draft as draft_service
from src.services import resume_render
from src.template_registry.service import TemplateRegistryService
from starlette.requests import Request

pytestmark = pytest.mark.asyncio
INSPECT_CHALLENGE = "/inference-mode/challenge/inspect"
CONFIRM_CHALLENGE = "/inference-mode/challenge/confirm"

sqlite3.register_adapter(list, json.dumps)


@compiles(ARRAY, "sqlite")
@compiles(JSONB, "sqlite")
def compile_postgres_json_for_sqlite(_type, _compiler, **_kwargs):
    return "JSON"


@pytest.fixture
async def account(monkeypatch, tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'mcp.sqlite'}")
    tables = [
        model.__table__ for model in (
            User, InferenceModeChallenge, Profile, UserExperience, UserProject, UserEducation, UserExtracurricular,
            Generation, GenerationLog, GenerationNodeMetric, SupportRateLimit, UserRateLimit, UserCreditOverride,
            AccountCleanupTask,
        )
    ]
    async with engine.begin() as conn:
        await conn.run_sync(lambda conn: Base.metadata.create_all(conn, tables=tables))
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr("src.mcp.context.AsyncSessionLocal", sessions)
    monkeypatch.setattr(job_runner, "AsyncSessionLocal", sessions)
    monkeypatch.setattr(settings, "ADMIN_EMAILS", "")
    monkeypatch.setattr(settings, "POSTHOG_PROJECT_TOKEN", "")
    monkeypatch.setattr(settings, "BACKEND_URL", "http://testserver")
    monkeypatch.setattr(settings, "FRONTEND_URL", "http://web.test")
    monkeypatch.setattr(settings, "JWT_SECRET", "test-own-model-signing-key")
    storage_dir = tmp_path / "objects"
    monkeypatch.setattr(settings, "LOCAL_STORAGE_DIR", storage_dir)
    for setting in ("R2_ENDPOINT_URL", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"):
        monkeypatch.setattr(settings, setting, "")

    async with sessions() as db:
        user = User(email="alex@example.test", name="Alex Developer")
        other = User(email="other@example.test", name="Other Developer")
        db.add_all((user, other))
        await db.flush()
        db.add(Profile(
            user_id=user.id, full_name=user.name, email=user.email, github_url="https://github.com/sample",
            skills=["Python", "FastAPI", "PostgreSQL", "Docker", "Git", "pytest"],
        ))
        for index in range(2):
            db.add(UserExperience(
                user_id=user.id, role="Backend Engineer", organization=f"Company {index}", sort_order=index,
                bullet_points=[
                    "Built a FastAPI service to index audited PostgreSQL records.",
                    "Added pytest coverage for API validation and deployment workflows.",
                ],
            ))
            db.add(UserProject(
                user_id=user.id, name=f"Data Tools {index}", description="Indexing tool for archived records.",
                technologies=["Python", "PostgreSQL"], sort_order=index,
                bullet_points=["Wrote PostgreSQL queries for indexed search.", "Packaged the API with Docker."],
            ))
        await db.commit()

    async def override_db():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    ctx = set_current_mcp_user(user)
    try:
        yield SimpleNamespace(user=user, other=other, db=sessions, storage_dir=storage_dir)
    finally:
        reset_current_mcp_user(ctx)
        app.dependency_overrides.pop(get_db)
        await engine.dispose()


@pytest.fixture
def fake_drafts(monkeypatch):
    def build(**kwargs):
        snapshot = {**kwargs, "requirements": {"experiences": 2, "projects": 2}}
        return {"snapshot": snapshot, "brief": {"writing_rules": "Use source facts.", "requirements": snapshot["requirements"]}}

    def normalize(_snapshot, raw):
        if raw.get("summary"):
            return raw, []
        return None, [{"path": "summary", "code": "missing_summary", "message": "Add a summary."}]

    def evaluate(*, snapshot, client_draft, submissions, attempts):
        text = client_draft["summary"]
        fits = text != "overflow"
        pinned_font = 10.0 if text == "worse" else 11.0
        upcoming = [{"path": "summary", "kind": "orphan"}] if text == "initial" else []
        return draft_service.DraftEvaluation(
            status="ready" if text == "ready" else "needs_revision", errors=[],
            issues=[] if text == "ready" else [{"kind": "underfilled_page", "severity": "blocking"}],
            more_issues=len(upcoming), layout={
                "page_count": 1 if fits else 2, "page_fill_percent": 0.91,
                "fits_target": fits, "pinned_font_size": pinned_font,
            },
            client_draft=client_draft, tailored_resume={"summary": text},
            score=[int(fits), int(text == "ready"), -2 if text == "worse" else -1, -0.09],
            attempts={"summary": {"chars": len(text)}, draft_service.LAYOUT_KEY: {"pinned_font_size": pinned_font}},
            upcoming=upcoming, upcoming_note="Fix the current issues first." if upcoming else None,
        )

    def finalize(*, snapshot, tailored_resume, submissions, finalized_reason, client_model, pinned_font_size=None):
        return draft_service.FinalizedResume(
            tailored_resume=tailored_resume, pdf_bytes=b"%PDF-fake", markdown="# Test",
            font_size=pinned_font_size or 11.0, page_count=1, fits_target=True, has_horizontal_overflow=False,
            page_fill_percent=0.91, quality={
                "submissions": submissions, "client_model": client_model, "font_source": "pinned",
                "has_horizontal_overflow": False, "renders": 1, "render_ms": 42,
            },
        )

    functions = {
        "build_client_brief": build,
        "render_brief": lambda snapshot, generation_id: {"writing_rules": "Use source facts."},
        "normalize_draft": normalize,
        "apply_revisions": lambda draft, revisions: ({**draft, "summary": revisions[0]["text"]}, []),
        "evaluate_draft": Mock(side_effect=evaluate),
        "finalize_draft": Mock(side_effect=finalize),
    }
    for name, fn in functions.items():
        monkeypatch.setattr(draft_service, name, fn)
    monkeypatch.setattr(client_generation, "render_thumbnail", lambda _: b"fake webp")
    return draft_service


async def set_own_model(account):
    async with account.db() as db:
        await db.execute(update(User).where(User.id == account.user.id).values(inference_mode="own_model"))
        await db.commit()


async def start_draft(account, **kwargs):
    await set_own_model(account)
    return await generation.generate_resume_handler("Build Python APIs", **kwargs)


async def add_generation(account, *, status="completed", inference_source="server", **kwargs):
    async with account.db() as db:
        row = Generation(
            user_id=account.user.id, template_id="personal-classic", job_description="Build Python APIs",
            status=status, inference_source=inference_source, **kwargs,
        )
        db.add(row)
        await db.commit()
        return row.id


def token_from_challenge(result):
    assert result["status"] == "confirmation_required"
    url = urlsplit(result["confirm_url"])
    assert url.path == "/connect/own-model" and not url.query
    return parse_qs(url.fragment)["c"][0]


def auth_headers(user):
    token, _ = create_oauth_access_token(user.id, user.email, "resume:generate", "own-model-tests")
    return {"Authorization": f"Bearer {token}"}


def web_session_headers(user):
    now = int(datetime.now(timezone.utc).timestamp())
    token = jwt.encode(
        {"sub": str(user.id), "email": user.email, "provider": "google", "iat": now, "exp": now + 3600},
        settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM,
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.parametrize("claims", [
    {"token_use": "oauth_handoff", "aud": "resumer-oauth-authorize"},
    {"token_use": "oauth_handoff"},
    {"aud": "resumer-oauth-authorize"},
    {"aud": None},
])
async def test_handoff_or_audience_tokens_cannot_authenticate_outside_authorize(account, claims):
    now = int(datetime.now(timezone.utc).timestamp())
    token = jwt.encode(
        {"sub": str(account.user.id), "email": account.user.email, "iat": now, "exp": now + 300, **claims},
        settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM,
    )
    headers = {"Authorization": f"Bearer {token}"}
    challenge = token_from_challenge(await inference_mode.set_inference_mode_handler("own_model"))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        assert (await client.get("/profile", headers=headers)).status_code == 401
        for mode in ("own_model", "resumer"):
            assert (await client.put("/inference-mode", json={"mode": mode}, headers=headers)).status_code == 401
        confirmed = await client.post(CONFIRM_CHALLENGE, json={"token": challenge}, headers=headers)
        assert confirmed.status_code == 401
        assert confirmed.headers["cache-control"] == "no-store"

    request = Request({"type": "http", "headers": [(b"cookie", f"auth_token={token}".encode())]})
    async with account.db() as db:
        assert await get_optional_user(request, None, db) is None


@pytest.mark.parametrize("claims", [
    {}, {"provider": ""}, {"provider": 123},
    {"provider": "google", "token_use": None}, {"provider": "google", "client_id": None},
])
async def test_web_session_requires_a_provider_and_no_client_claims(account, claims):
    token = jwt.encode(
        {"sub": str(account.user.id), **claims}, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM,
    )
    headers = {"Authorization": f"Bearer {token}"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        assert (await client.get("/profile", headers=headers)).status_code == 200
        change = await client.put("/inference-mode", json={"mode": "own_model"}, headers=headers)
        assert change.status_code == 403
        assert change.json()["detail"]["code"] == "web_session_required"


@pytest.mark.parametrize("deleted", [False, True])
async def test_mcp_handlers_handle_an_account_unavailable_since_authentication(account, deleted):
    async with account.db() as db:
        if deleted:
            await db.execute(delete(User).where(User.id == account.user.id))
        else:
            await db.execute(update(User).where(User.id == account.user.id).values(
                deletion_scheduled_for=datetime.now(timezone.utc) + timedelta(days=7),
            ))
        await db.commit()

    results = [
        await inference_mode.get_inference_mode_handler(),
        await inference_mode.set_inference_mode_handler("own_model"),
        await inference_mode.set_inference_mode_handler("resumer"),
        await generation.generate_resume_handler("Build Python APIs"),
        await generation.set_generation_defaults_handler(creativity_mode="proper"),
    ]
    for result in results:
        assert result["success"] is False
        assert result["error_code"] == "ACCOUNT_UNAVAILABLE"


def write_generation_artifacts(generation_id, *extra_keys):
    storage = StorageService()
    keys = [f"runs/{generation_id}/{name}" for name in ("resume.pdf", "resume.md", "thumb.webp")]
    keys.extend(extra_keys)
    for key in keys:
        assert storage.upload_bytes(b"artifact", key)
    return keys


async def test_mcp_mode_confirmation_rest_and_default(account, monkeypatch):
    events = Mock()
    monkeypatch.setattr("src.api.inference_mode.capture_inference_mode_changed", events)
    assert (await inference_mode.get_inference_mode_handler())["mode"] == "resumer"
    assert (await inference_mode.set_inference_mode_handler("unknown"))["error_code"] == "INVALID_INFERENCE_MODE"
    first = token_from_challenge(await inference_mode.set_inference_mode_handler("own_model"))
    second = token_from_challenge(await inference_mode.set_inference_mode_handler("own_model"))
    async with account.db() as db:
        challenge = await db.scalar(select(InferenceModeChallenge).where(InferenceModeChallenge.token_hash == hash_token(second)))
        assert challenge.token_hash != second
        assert challenge.expires_at - challenge.created_at == timedelta(minutes=15)

    headers = web_session_headers(account.user)
    oauth_headers = auth_headers(account.user)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        assert (await client.get("/inference-mode")).status_code == 401
        assert (await client.put("/inference-mode", json={"mode": "own_model"})).status_code == 401
        invalidated = await client.post(CONFIRM_CHALLENGE, json={"token": first}, headers=headers)
        assert invalidated.status_code == 409
        assert invalidated.json()["detail"]["code"] == "already_used"
        for _ in range(2):
            inspected = await client.post(INSPECT_CHALLENGE, json={"token": second}, headers=headers)
            assert inspected.status_code == 200
            assert inspected.headers["cache-control"] == "no-store"
            assert inspected.json() == {
                "valid": True, "expires_at": inspected.json()["expires_at"],
                "account_matches": True, "current_mode": "resumer", "reason": None,
            }
            assert inspected.json()["expires_at"] is not None
        assert (await inference_mode.get_inference_mode_handler())["mode"] == "resumer"
        confirm = await client.post(CONFIRM_CHALLENGE, json={"token": second}, headers=headers)
        assert confirm.status_code == 200
        assert confirm.headers["cache-control"] == "no-store"
        assert confirm.json()["mode"] == "own_model" and confirm.json()["changed_at"]
        reused = await client.post(CONFIRM_CHALLENGE, json={"token": second}, headers=headers)
        assert (reused.status_code, reused.json()["detail"]["code"]) == (409, "already_used")
        used = await client.post(INSPECT_CHALLENGE, json={"token": second}, headers=headers)
        assert used.json() == {
            "valid": False, "expires_at": None, "account_matches": True, "current_mode": None, "reason": "used",
        }
        invalid = await client.post(CONFIRM_CHALLENGE, json={"token": "invalid"}, headers=headers)
        assert (invalid.status_code, invalid.json()["detail"]["code"]) == (404, "invalid_challenge")
        unknown = await client.post(INSPECT_CHALLENGE, json={"token": "invalid"}, headers=headers)
        assert unknown.json() == {
            "valid": False, "expires_at": None, "account_matches": False, "current_mode": None, "reason": "invalid",
        }
        assert (await client.get("/inference-mode", headers=oauth_headers)).json()["mode"] == "own_model"
        assert (await client.get("/inference-mode", headers=auth_headers(account.other))).json()["mode"] == "resumer"
        assert (await client.put("/inference-mode", headers=headers, json={"mode": "no"})).status_code == 422
        pending = token_from_challenge(await inference_mode.set_inference_mode_handler("own_model"))
        resumer = await client.put("/inference-mode", headers=oauth_headers, json={"mode": "resumer"})
        assert resumer.status_code == 200 and resumer.json()["mode"] == "resumer"
        assert (await client.post(CONFIRM_CHALLENGE, json={"token": pending}, headers=headers)).status_code == 409
        assert (await client.put("/inference-mode", headers=headers, json={"mode": "own_model"})).json()["mode"] == "own_model"
        assert (await inference_mode.set_inference_mode_handler("resumer"))["mode"] == "resumer"
        assert (await inference_mode.get_inference_mode_handler())["mode"] == "resumer"

    assert [call.args[1:] for call in events.call_args_list] == [
        ("resumer", "own_model", "mcp_link"), ("own_model", "resumer", "web"),
        ("resumer", "own_model", "web"), ("own_model", "resumer", "mcp"),
    ]


async def test_enable_own_model_requires_the_challenge_owners_web_session(account):
    token_body = {"token": token_from_challenge(await inference_mode.set_inference_mode_handler("own_model"))}
    oauth_headers = auth_headers(account.user)
    other_session = web_session_headers(account.other)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        enable = await client.put("/inference-mode", json={"mode": "own_model"}, headers=oauth_headers)
        for response in (
            enable,
            await client.post(INSPECT_CHALLENGE, json=token_body, headers=oauth_headers),
            await client.post(CONFIRM_CHALLENGE, json=token_body, headers=oauth_headers),
        ):
            assert response.status_code == 403
            assert response.json()["detail"] == {
                "code": "web_session_required",
                "message": "Sign in to Résumer in your browser to change this.",
            }
        for path in (INSPECT_CHALLENGE, CONFIRM_CHALLENGE):
            unauthenticated = await client.post(path, json=token_body)
            assert unauthenticated.status_code == 401
            assert unauthenticated.headers["cache-control"] == "no-store"
        wrong_account = await client.post(INSPECT_CHALLENGE, json=token_body, headers=other_session)
        assert wrong_account.status_code == 200
        assert wrong_account.json() == {
            "valid": False, "expires_at": None, "account_matches": False, "current_mode": None,
            "reason": "wrong_account",
        }
        forbidden = await client.post(CONFIRM_CHALLENGE, json=token_body, headers=other_session)
        assert forbidden.status_code == 403 and forbidden.json()["detail"] == {"code": "wrong_account"}
        assert forbidden.headers["cache-control"] == "no-store"
        owner_session = web_session_headers(account.user)
        assert (await client.get("/inference-mode", headers=owner_session)).json()["mode"] == "resumer"
        assert (await client.post(INSPECT_CHALLENGE, json=token_body, headers=owner_session)).json()["valid"]
    challenge_paths = {path for path in app.openapi()["paths"] if path.startswith("/inference-mode/challenge/")}
    assert challenge_paths == {INSPECT_CHALLENGE, CONFIRM_CHALLENGE}


async def test_expired_challenge_and_mcp_resumer_cancellation(account):
    token = token_from_challenge(await inference_mode.set_inference_mode_handler("own_model"))
    async with account.db() as db:
        await db.execute(update(InferenceModeChallenge).values(expires_at=datetime.now(timezone.utc) - timedelta(minutes=1)))
        await db.commit()
    headers = web_session_headers(account.user)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver", headers=headers) as client:
        inspected = await client.post(INSPECT_CHALLENGE, json={"token": token})
        assert inspected.json() == {
            "valid": False, "expires_at": None, "account_matches": True, "current_mode": None, "reason": "expired",
        }
        confirm = await client.post(CONFIRM_CHALLENGE, json={"token": token})
        assert (confirm.status_code, confirm.json()["detail"]["code"]) == (410, "expired")
        token = token_from_challenge(await inference_mode.set_inference_mode_handler("own_model"))
        assert (await inference_mode.set_inference_mode_handler("resumer"))["mode"] == "resumer"
        assert (await client.post(CONFIRM_CHALLENGE, json={"token": token})).status_code == 409


async def test_own_model_uses_fresh_db_mode_and_separate_cap(account, fake_drafts, monkeypatch):
    monkeypatch.setattr(settings, "OWN_MODEL_DAILY_DRAFT_CAP", 1)
    trigger = AsyncMock()
    monkeypatch.setattr(generation, "trigger_pipeline", trigger)
    accepted = Mock()
    monkeypatch.setattr(client_generation, "capture_generation", accepted)
    brief = await start_draft(account, client_model="m" * 140, creativity_mode="larp")
    assert account.user.inference_mode == "resumer"
    assert brief["status"] == "awaiting_draft"
    assert brief["inference_mode"] == "own_model"
    assert brief["next_tool"] == "submit_resume_draft"
    trigger.assert_not_awaited()
    async with account.db() as db:
        gen = await db.get(Generation, uuid.UUID(brief["generation_id"]))
        assert (gen.status, gen.inference_source, gen.send_email, gen.creativity_mode) == ("drafting", "client", False, "larp")
        assert gen.client_model == "m" * 120
        assert await db.scalar(select(func.count()).select_from(UserRateLimit)) == 0
        assert await db.scalar(select(SupportRateLimit.key)) == f"own-model:{account.user.id}"
    assert accepted.call_args.args[1] == "accepted"
    compact = await generation.get_generation_status_handler(brief["generation_id"])
    assert compact["status"] == "awaiting_draft"
    assert "writing_rules" not in compact and "render_metadata" not in compact
    recovered = await generation.get_generation_status_handler(brief["generation_id"], include_brief=True)
    assert recovered["writing_rules"] == brief["writing_rules"]
    assert (await generation.generate_resume_handler("Build Python APIs"))["error_code"] == "OWN_MODEL_LIMIT_REACHED"
    monkeypatch.setattr(settings, "ADMIN_EMAILS", "*")
    assert (await generation.generate_resume_handler("Build Python APIs"))["status"] == "awaiting_draft"


async def test_server_quota_notice_and_summary_by_source(account, fake_drafts, monkeypatch):
    monkeypatch.setattr(generation, "trigger_pipeline", AsyncMock())
    async with account.db() as db:
        db.add(UserCreditOverride(user_id=account.user.id, daily_cap=2, monthly_cap=2))
        await db.commit()
    for status in ("drafting", "completed", "failed"):
        await add_generation(account, status=status, inference_source="client")

    first = await generation.generate_resume_handler("Build APIs", wait_for_completion=False)
    second = await generation.generate_resume_handler("Build APIs", wait_for_completion=False)
    blocked = await generation.generate_resume_handler("Build APIs", wait_for_completion=False)
    assert first["inference_mode"] == "resumer"
    assert first["daily_quota"]["remaining"] == 1 and first["user_notice"]
    assert second["daily_quota"]["remaining"] == 0
    assert blocked["error_code"] == "RATE_LIMIT_EXCEEDED"
    assert blocked["error"].startswith("Monthly cap reached") and blocked["user_notice"]

    headers = auth_headers(account.user)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        summary = (await client.get("/generate/summary", headers=headers)).json()
        assert summary["total"] == 5
        assert summary["usable_total"] == 3
        assert summary["this_month"] == summary["used_today"] == 2
        assert summary["daily_cap"] == summary["monthly_cap"] == 2
        async with account.db() as db:
            override = await db.get(UserCreditOverride, account.user.id)
            override.monthly_cap = 0
            await db.commit()
        daily_blocked = await generation.generate_resume_handler("Build APIs", wait_for_completion=False)
        assert daily_blocked["error"].startswith("Rate limit:")
        assert daily_blocked["daily_quota"] == second["daily_quota"]
        async with account.db() as db:
            bucket = await db.get(UserRateLimit, account.user.id)
            bucket.reset_at = datetime.now(timezone.utc) - timedelta(minutes=1)
            await db.commit()
        summary = (await client.get("/generate/summary", headers=headers)).json()
        assert summary["used_today"] == 0 and summary["this_month"] == 2
        async with account.db() as db:
            override = await db.get(UserCreditOverride, account.user.id)
            override.daily_cap = 0
            await db.commit()
        summary = (await client.get("/generate/summary", headers=headers)).json()
        assert summary["daily_cap"] is None


async def test_submit_lifecycle_and_terminal_cleanup(account, fake_drafts):
    brief = await start_draft(account)
    gen_id = brief["generation_id"]
    rejected = await client_generation.submit_resume_draft_handler(gen_id, resume_json={})
    invalid = await generation.get_generation_status_handler(gen_id)
    assert rejected["status"] == "invalid_draft" and rejected["success"] is False
    for field in ("status", "errors", "issues", "more_issues", "layout"):
        assert invalid["last_report"][field] == rejected[field]
    # Invalid batches never render, so they don't spend a render submission.
    assert invalid["draft_revision"] == 0 and invalid["submissions_used"] == 0
    fake_drafts.evaluate_draft.assert_not_called()

    first = await client_generation.submit_resume_draft_handler(gen_id, resume_json={"summary": "initial"})
    assert first["status"] == "needs_revision" and first["draft_revision"] == 1
    assert first["client_draft"] == {"summary": "initial"}
    assert first["more_issues"] == 1 and first["upcoming"] == [{"path": "summary", "kind": "orphan"}]
    status = await generation.get_generation_status_handler(gen_id)
    assert status["last_report"]["upcoming"] == first["upcoming"]
    assert status["last_report"]["upcoming_note"] == first["upcoming_note"] == "Fix the current issues first."

    conflict = await client_generation.submit_resume_draft_handler(
        gen_id, revisions=[{"path": "summary", "text": "ready"}], expected_draft_revision=0,
    )
    assert conflict["error_code"] == "DRAFT_REVISION_CONFLICT"
    assert conflict["client_draft"] == first["client_draft"] and conflict["submissions_used"] == 1

    completed = await client_generation.submit_resume_draft_handler(
        gen_id, revisions=[{"path": "summary", "text": "ready"}], expected_draft_revision=1,
    )
    assert completed["status"] == "completed" and completed["quality"]["finalized_reason"] == "ready"
    assert completed["draft_revision"] == 2 and completed["resume_json"] == {"summary": "ready"}
    assert fake_drafts.evaluate_draft.call_args.kwargs["attempts"] == {
        "summary": {"chars": len("initial")}, draft_service.LAYOUT_KEY: {"pinned_font_size": 11.0},
    }
    assert completed["download_url"]
    completed_status = await generation.get_generation_status_handler(gen_id, include_brief=True)
    assert "render_metadata" not in completed_status and "writing_rules" not in completed_status
    assert completed_status["quality"] == completed["quality"]
    async with account.db() as db:
        gen = await db.get(Generation, uuid.UUID(gen_id))
        assert gen.completed_at and gen.model_used == "client:unknown"
        assert gen.render_metadata["profile"]["email"] == account.user.email
        assert gen.render_metadata["quality"]["requirements"] == brief["requirements"]
        assert gen.render_metadata["page_fill_percent"] == 0.91
        assert not {
            "client_brief", "client_draft", "client_last_report", "client_claim", "client_attempts",
            "client_best", "client_latest", "client_invalid_submissions",
        } & set(gen.render_metadata)
        assert (await db.get(User, account.user.id)).first_generation_completed
        assert all((account.storage_dir / key).is_file() for key in (gen.pdf_storage_key, gen.md_storage_key, gen.thumb_storage_key))

    denied = await client_generation.submit_resume_draft_handler(gen_id, finalize=True)
    assert denied["error_code"] == "DRAFT_NOT_ACTIVE" and "editor tools" in denied["message"]


@pytest.mark.parametrize("cap", [1, 6])
async def test_unverified_final_render_preserves_draft_and_submission_budget(account, fake_drafts, monkeypatch, cap):
    monkeypatch.setattr(settings, "OWN_MODEL_MAX_SUBMISSIONS", cap)
    gen_id = (await start_draft(account))["generation_id"]
    finalize = fake_drafts.finalize_draft.side_effect

    fake_drafts.finalize_draft.side_effect = draft_service.FinalizeUnverified("Could not verify layout")
    submit = client_generation.submit_resume_draft_handler
    response = await submit(gen_id, resume_json={"summary": "ready"})
    assert response["error_code"] == "DRAFT_RENDER_FAILED"
    assert response["submissions_used"] == 0 and response["submissions_left"] == cap
    assert "Retry" in response["next_step"]
    assert not account.storage_dir.exists()
    async with account.db() as db:
        row = await db.get(Generation, uuid.UUID(gen_id))
        assert row.status == "drafting" and row.completed_at is None
        assert row.pdf_storage_key is None and row.md_storage_key is None and row.thumb_storage_key is None
        assert "client_claim" not in row.render_metadata
        assert row.render_metadata["client_submissions"] == 0
        assert row.render_metadata["client_last_report"]["error_code"] == "DRAFT_RENDER_FAILED"
        assert row.render_metadata["client_latest"]["draft"] == response["client_draft"] == {"summary": "ready"}

    fake_drafts.finalize_draft.side_effect = finalize
    retry = await submit(gen_id, finalize=True, expected_draft_revision=response["draft_revision"])
    assert retry["status"] == "completed"
    assert retry["submissions_used"] == 1


async def test_pinned_overflow_feedback_and_attempts_round_trip(account, fake_drafts, monkeypatch):
    monkeypatch.setattr(settings, "OWN_MODEL_MAX_SUBMISSIONS", 3)
    evaluate = fake_drafts.evaluate_draft.side_effect
    upcoming = [{
        "path": "experiences[0].bullet_points[0]", "kind": "oversize", "visible_chars": 201,
        "rendered_lines": 3, "target_chars": {"min": 166, "max": 186, "aim": 176}, "measured_at_font": 11.0,
    }]
    underfill = {
        "kind": "underfilled_page", "severity": "blocking",
        "budget": {"free_lines": 3, "max_new_bullets": 1, "max_added_chars": 180},
    }

    def feedback(**kwargs):
        evaluation = evaluate(**kwargs)
        if kwargs["submissions"] == 1:
            evaluation.layout.update(font_source="pinned_overflow", font_stable=False)
            evaluation.attempts[draft_service.LAYOUT_KEY]["held_overflow"] = True
            evaluation.issues = [{"kind": "page_overflow", "severity": "blocking"}]
            evaluation.upcoming = upcoming
            evaluation.more_issues = len(upcoming)
            evaluation.upcoming_note = "Fix page overflow first."
        elif kwargs["submissions"] == 2:
            evaluation.layout.update(font_source="pinned", font_stable=True)
            evaluation.issues = [underfill]
        return evaluation

    fake_drafts.evaluate_draft.side_effect = feedback
    gen_id = (await start_draft(account))["generation_id"]
    submit = client_generation.submit_resume_draft_handler
    first = await submit(gen_id, resume_json={"summary": "overflow"})
    assert first["status"] == "needs_revision" and first["submissions_left"] == 2
    assert first["layout"]["font_source"] == "pinned_overflow"
    assert first["layout"]["fits_target"] is first["layout"]["font_stable"] is False
    assert first["upcoming"] == upcoming and first["upcoming_note"] == "Fix page overflow first."
    status = await generation.get_generation_status_handler(gen_id)
    assert status["last_report"]["upcoming"] == upcoming
    assert status["last_report"]["layout"] == first["layout"]
    fake_drafts.finalize_draft.assert_not_called()

    second = await submit(gen_id, resume_json={"summary": "worse"}, expected_draft_revision=1)
    assert second["status"] == "needs_revision" and second["submissions_left"] == 1
    assert second["issues"] == [underfill] and second["layout"]["font_stable"] is True
    assert (await generation.get_generation_status_handler(gen_id))["last_report"]["issues"] == [underfill]
    assert fake_drafts.evaluate_draft.call_args.kwargs["attempts"] == {
        "summary": {"chars": len("overflow")},
        draft_service.LAYOUT_KEY: {"pinned_font_size": 11.0, "held_overflow": True},
    }
    fake_drafts.finalize_draft.assert_not_called()

    third = await submit(gen_id, resume_json={"summary": "ready"}, expected_draft_revision=2)
    assert third["status"] == "completed" and third["quality"]["finalized_reason"] == "submission_cap"
    assert [call.kwargs["submissions"] for call in fake_drafts.evaluate_draft.call_args_list] == [1, 2, 3]
    assert fake_drafts.evaluate_draft.call_args.kwargs["attempts"][draft_service.LAYOUT_KEY] == {"pinned_font_size": 10.0}


async def test_unverified_final_render_stops_retrying_after_three_attempts(account, fake_drafts):
    gen_id = (await start_draft(account))["generation_id"]
    submit = client_generation.submit_resume_draft_handler
    finalize = fake_drafts.finalize_draft.side_effect
    fake_drafts.finalize_draft.side_effect = draft_service.FinalizeUnverified("Could not verify layout")

    first = await submit(gen_id, resume_json={"summary": "ready"})
    assert first["error_code"] == "DRAFT_RENDER_FAILED" and first["submissions_used"] == 0
    second = await submit(gen_id, resume_json={"summary": "ready"}, expected_draft_revision=1)
    assert second["error_code"] == "DRAFT_RENDER_FAILED" and second["draft_revision"] == 2
    third = await submit(gen_id, finalize=True, expected_draft_revision=2)
    assert third["status"] == "error" and third["error_code"] == "DRAFT_RENDER_ATTEMPTS_EXHAUSTED"
    assert "change the draft" in third["message"] and "Retry" not in third["next_step"]
    assert third["unverifiable_draft_revisions"] == [1, 2]
    assert third["submissions_used"] == 1  # No more refunds once retries stop.

    # The same revision is not rendered again; asking for it still spends a submission.
    again = await submit(gen_id, finalize=True, expected_draft_revision=2)
    assert again["error_code"] == "DRAFT_RENDER_ATTEMPTS_EXHAUSTED" and again["submissions_used"] == 2
    assert fake_drafts.finalize_draft.call_count == 3
    assert not account.storage_dir.exists()
    status = await generation.get_generation_status_handler(gen_id)
    assert status["status"] == "awaiting_draft"
    assert status["last_report"]["error_code"] == "DRAFT_RENDER_ATTEMPTS_EXHAUSTED"

    fake_drafts.finalize_draft.side_effect = finalize
    changed = await submit(gen_id, revisions=[{"path": "summary", "text": "ready"}], expected_draft_revision=2)
    assert changed["status"] == "completed" and changed["quality"]["finalized_draft_revision"] == 3
    async with account.db() as db:
        row = await db.get(Generation, uuid.UUID(gen_id))
        assert row.status == "completed"
        assert not {"client_unverified_attempts", "client_unverified_revisions"} & set(row.render_metadata)


async def test_unverified_final_render_fails_once_no_submissions_are_left(account, fake_drafts, monkeypatch):
    monkeypatch.setattr(settings, "OWN_MODEL_MAX_SUBMISSIONS", 1)
    gen_id = (await start_draft(account))["generation_id"]
    submit = client_generation.submit_resume_draft_handler
    fake_drafts.finalize_draft.side_effect = draft_service.FinalizeUnverified("Could not verify layout")

    for _ in range(2):
        assert (await submit(gen_id, finalize=True) if _ else await submit(gen_id, resume_json={"summary": "ready"}))[
            "error_code"] == "DRAFT_RENDER_FAILED"
    last = await submit(gen_id, finalize=True)
    assert last["status"] == "failed" and last["error_code"] == "DRAFT_RENDER_ATTEMPTS_EXHAUSTED"
    assert "next_step" not in last
    assert fake_drafts.finalize_draft.call_count == 3
    assert (await submit(gen_id, finalize=True))["error_code"] == "DRAFT_NOT_ACTIVE"
    async with account.db() as db:
        row = await db.get(Generation, uuid.UUID(gen_id))
        assert row.status == "failed" and row.error_message == last["message"]
        assert "client_unverified_attempts" not in row.render_metadata


@pytest.mark.parametrize("raise_error", [False, True])
async def test_pdf_upload_failure_keeps_draft_retryable_at_cap(account, fake_drafts, monkeypatch, raise_error):
    monkeypatch.setattr(settings, "OWN_MODEL_MAX_SUBMISSIONS", 1)
    gen_id = (await start_draft(account))["generation_id"]
    submit = client_generation.submit_resume_draft_handler
    upload = StorageService.upload_bytes
    uploads = []

    def fail_after_write(storage, data, key, content_type):
        uploads.append(content_type)
        assert upload(storage, data, key, content_type)
        if raise_error:
            raise OSError("storage timeout")
        return False

    with monkeypatch.context() as patch:
        patch.setattr(StorageService, "upload_bytes", fail_after_write)
        failed = await submit(gen_id, resume_json={"summary": "ready"})
    assert failed["error_code"] == "DRAFT_RENDER_FAILED" and "Retry" in failed["next_step"]
    assert failed["submissions_used"] == 0 and failed["submissions_left"] == 1
    assert "download_url" not in failed
    assert uploads == ["application/pdf"] and not list(account.storage_dir.rglob("*.*"))
    async with account.db() as db:
        row = await db.get(Generation, uuid.UUID(gen_id))
        assert row.status == "drafting" and row.completed_at is None
        assert row.pdf_storage_key is None and row.md_storage_key is None and row.thumb_storage_key is None
        assert "client_claim" not in row.render_metadata
        assert row.render_metadata["client_publish_failures"] == 1
        assert not (await db.get(User, account.user.id)).first_generation_completed

    completed = await submit(gen_id, finalize=True, expected_draft_revision=failed["draft_revision"])
    assert completed["status"] == "completed" and completed["submissions_used"] == 1
    assert (account.storage_dir / f"runs/{gen_id}/resume.pdf").is_file()
    async with account.db() as db:
        row = await db.get(Generation, uuid.UUID(gen_id))
        assert "client_publish_failures" not in row.render_metadata


@pytest.mark.parametrize("cap", [1, 6])
async def test_pdf_upload_failure_stops_retrying_after_three_attempts(account, fake_drafts, monkeypatch, cap):
    monkeypatch.setattr(settings, "OWN_MODEL_MAX_SUBMISSIONS", cap)
    pdf_upload = Mock(return_value=False)
    monkeypatch.setattr(StorageService, "upload_bytes", pdf_upload)
    gen_id = (await start_draft(account))["generation_id"]
    submit = client_generation.submit_resume_draft_handler

    first = await submit(gen_id, resume_json={"summary": "ready"})
    second = await submit(gen_id, finalize=True, expected_draft_revision=1)
    for result in (first, second):
        assert result["error_code"] == "DRAFT_RENDER_FAILED"
        assert result["submissions_used"] == 0 and "Retry" in result["next_step"]
    third = await submit(gen_id, finalize=True, expected_draft_revision=1)
    assert third["status"] == "failed" and third["error_code"] == "DRAFT_RENDER_FAILED"
    assert third["submissions_used"] == 1 and "next_step" not in third
    assert "PDF" in third["message"] and "3" in third["message"]
    assert (await submit(gen_id, finalize=True))["error_code"] == "DRAFT_NOT_ACTIVE"
    assert fake_drafts.finalize_draft.call_count == pdf_upload.call_count == 3
    async with account.db() as db:
        row = await db.get(Generation, uuid.UUID(gen_id))
        assert row.status == "failed" and row.error_message == third["message"]
        assert row.pdf_storage_key is None
        assert "client_publish_failures" not in row.render_metadata


@pytest.mark.parametrize(
    "cap,latest_summary,reason,saved_revision",
    [(6, "worse", "requested", 2), (6, "overflow", "requested", 1), (3, "worse", "submission_cap", 1)],
)
async def test_selects_draft_for_requested_finalize_or_cap(
    account, fake_drafts, monkeypatch, cap, latest_summary, reason, saved_revision,
):
    monkeypatch.setattr(settings, "OWN_MODEL_MAX_SUBMISSIONS", cap)
    gen_id = (await start_draft(account))["generation_id"]
    submit = client_generation.submit_resume_draft_handler
    await submit(gen_id, resume_json={"summary": "initial", "job_analysis": {"job_title": "Python Engineer"}})
    latest = {"summary": latest_summary, "job_analysis": {"job_title": "API Engineer"}}
    revised = await submit(gen_id, resume_json=latest)
    assert revised["status"] == "needs_revision"
    assert revised["best_draft_revision"] == 1 and revised["draft_revision"] == 2
    assert "measured better" in revised["next_step"]
    async with account.db() as db:
        row = await db.get(Generation, uuid.UUID(gen_id))
        candidate = row.render_metadata["client_latest"]
        assert candidate["draft"] == latest and candidate["draft_revision"] == 2
        assert candidate["fits_target"] == (latest_summary != "overflow")
        assert isinstance(candidate["score"], list) and len(candidate["score"]) == 4
        assert row.render_metadata["client_best"]["draft_revision"] == 1

    completed = (
        await submit(gen_id, finalize=True) if reason == "requested"
        else await submit(gen_id, resume_json={"summary": "worse"})
    )
    assert completed["status"] == "completed"
    assert completed["quality"]["finalized_reason"] == reason
    assert completed["quality"]["finalized_draft_revision"] == saved_revision
    if saved_revision == 2:
        assert completed["resume_json"] == {"summary": latest_summary} and completed["job_title"] == "API Engineer"
        assert completed["font_size"] == 10.0
    else:
        assert completed["resume_json"] == {"summary": "initial"} and completed["job_title"] == "Python Engineer"
        assert completed["font_size"] == 11.0
    assert fake_drafts.finalize_draft.call_args.kwargs["pinned_font_size"] == completed["font_size"]


@pytest.mark.parametrize("blocked_summary", ["initial", "worse"])
async def test_finalization_uses_the_other_candidate_when_one_is_blocked(
    account, fake_drafts, monkeypatch, blocked_summary,
):
    best_is_blocked = blocked_summary == "initial"
    monkeypatch.setattr(settings, "OWN_MODEL_MAX_SUBMISSIONS", 3 if best_is_blocked else 6)
    gen_id = (await start_draft(account))["generation_id"]
    submit = client_generation.submit_resume_draft_handler
    await submit(gen_id, resume_json={"summary": "initial"})
    if not best_is_blocked:
        await submit(gen_id, resume_json={"summary": "worse"})

    finalize = fake_drafts.finalize_draft.side_effect
    fake_drafts.finalize_draft.side_effect = draft_service.FinalizeUnverified("Could not verify layout")
    for _ in range(3):
        blocked = await submit(gen_id, finalize=True)
    assert blocked["error_code"] == "DRAFT_RENDER_ATTEMPTS_EXHAUSTED"
    assert blocked["unverifiable_draft_revisions"] == [1 if best_is_blocked else 2]
    tried = [c.kwargs["tailored_resume"] for c in fake_drafts.finalize_draft.call_args_list]
    assert {"summary": blocked_summary} in tried

    fake_drafts.finalize_draft.side_effect = finalize
    saved = (
        await submit(gen_id, resume_json={"summary": "worse"}) if best_is_blocked
        else await submit(gen_id, finalize=True)
    )
    assert saved["status"] == "completed"
    assert saved["quality"]["finalized_reason"] == ("submission_cap" if best_is_blocked else "requested")
    assert saved["quality"]["finalized_draft_revision"] == (2 if best_is_blocked else 1)
    assert saved["resume_json"] == {"summary": "worse" if best_is_blocked else "initial"}


async def test_automatically_finalizes_ready_draft_even_when_previous_draft_scores_higher(account, fake_drafts):
    evaluate = fake_drafts.evaluate_draft.side_effect

    def score_ready_lower(**kwargs):
        evaluation = evaluate(**kwargs)
        if evaluation.status == "ready":
            evaluation.score = [1, 0, -2, -0.09]
        return evaluation

    fake_drafts.evaluate_draft.side_effect = score_ready_lower
    gen_id = (await start_draft(account))["generation_id"]
    submit = client_generation.submit_resume_draft_handler
    previous = await submit(gen_id, resume_json={"summary": "initial"})
    assert previous["status"] == "needs_revision" and previous["best_draft_revision"] == 1
    completed = await submit(gen_id, resume_json={"summary": "ready", "job_analysis": {"job_title": "Engineer"}})
    assert completed["status"] == "completed"
    assert completed["resume_json"] == {"summary": "ready"} and completed["job_title"] == "Engineer"
    assert completed["quality"]["finalized_reason"] == "ready"
    assert completed["quality"]["finalized_draft_revision"] == 2


async def test_invalid_draft_exhaustion_and_submit_access_errors(account, fake_drafts, monkeypatch):
    monkeypatch.setattr(settings, "OWN_MODEL_MAX_SUBMISSIONS", 1)
    monkeypatch.setattr(settings, "OWN_MODEL_MAX_INVALID_SUBMISSIONS", 0)
    gen_id = (await start_draft(account))["generation_id"]
    submit = client_generation.submit_resume_draft_handler
    assert (await submit("bogus"))["error_code"] == "INVALID_GENERATION_ID"
    assert (await submit(gen_id, resume_json={"summary": "x" * 65536}))["error_code"] == "payload_too_large"
    token = set_current_mcp_user(account.other)
    try:
        assert (await submit(gen_id, resume_json={}))["error_code"] == "GENERATION_NOT_FOUND"
    finally:
        reset_current_mcp_user(token)
    server_gen = await add_generation(account, status="pending")
    assert (await submit(str(server_gen), resume_json={}))["error_code"] == "NOT_CLIENT_GENERATION"
    rejected = await submit(gen_id, revisions=[{"path": "summary", "text": "initial"}])
    assert rejected["status"] == "invalid_draft" and rejected["submissions_left"] == 0
    assert "No submissions are left" in rejected["next_step"]
    final = await submit(gen_id, finalize=True)
    assert final["status"] == "failed" and final["error_code"] == "DRAFT_SUBMISSIONS_EXHAUSTED"
    assert final["submissions_used"] == rejected["submissions_used"] == 1
    assert (await submit(gen_id, finalize=True))["error_code"] == "DRAFT_NOT_ACTIVE"
    fake_drafts.evaluate_draft.assert_not_called()


async def test_busy_guard_and_claim_loss(account, fake_drafts, monkeypatch):
    gen_id = (await start_draft(account))["generation_id"]
    other_id = (await start_draft(account))["generation_id"]
    submit = client_generation.submit_resume_draft_handler
    entered, release = Event(), Event()
    original = fake_drafts.evaluate_draft

    def blocked_evaluation(**kwargs):
        entered.set()
        assert release.wait(5)
        return original(**kwargs)

    monkeypatch.setattr(fake_drafts, "evaluate_draft", blocked_evaluation)
    pending = asyncio.create_task(submit(gen_id, resume_json={"summary": "ready"}))
    try:
        assert await asyncio.to_thread(entered.wait, 5)
        busy = await submit(other_id, resume_json={"summary": "ready"})
        assert busy["error_code"] == "busy" and busy["submissions_used"] == 0
        async with account.db() as db:
            row = await db.get(Generation, uuid.UUID(gen_id))
            assert row.render_metadata["client_draft_revision"] == 1
            assert row.render_metadata["client_claim"]["id"]
            row.render_metadata = {**row.render_metadata, "client_claim": {"id": "replacement"}}
            await db.commit()
    finally:
        release.set()
        result = await pending
    assert result["error_code"] == "DRAFT_CLAIM_LOST"
    assert not account.storage_dir.exists()


async def test_client_cancellation_does_not_release_render_slot(account, fake_drafts, monkeypatch):
    gen_id = (await start_draft(account))["generation_id"]
    submit = client_generation.submit_resume_draft_handler
    entered, release = Event(), Event()
    original = fake_drafts.evaluate_draft

    def blocked_evaluation(**kwargs):
        entered.set()
        assert release.wait(5)
        return original(**kwargs)

    monkeypatch.setattr(fake_drafts, "evaluate_draft", blocked_evaluation)
    caller = asyncio.create_task(submit(gen_id, resume_json={"summary": "ready"}))
    try:
        assert await asyncio.to_thread(entered.wait, 5)
        caller.cancel()
        with pytest.raises(asyncio.CancelledError):
            await caller
        assert (await submit(gen_id, finalize=True))["error_code"] == "busy"
    finally:
        release.set()
        if not caller.done():
            await caller
        if worker := client_generation._active_submissions.get(account.user.id):
            await worker
    assert (await generation.get_generation_status_handler(gen_id))["status"] == "completed"


async def test_upload_releases_render_slot_but_keeps_account_guard(account, fake_drafts, monkeypatch):
    gen_id = (await start_draft(account))["generation_id"]
    submit = client_generation.submit_resume_draft_handler
    entered, release = Event(), Event()
    upload = client_generation._upload_artifacts

    def blocked_upload(*args):
        entered.set()
        assert release.wait(15)
        return upload(*args)

    monkeypatch.setattr(client_generation, "_upload_artifacts", blocked_upload)
    pending = asyncio.create_task(submit(gen_id, resume_json={"summary": "ready"}))
    try:
        assert await asyncio.to_thread(entered.wait, 10)
        assert client_generation._render_slots.borrowed_tokens == 0
        assert (await submit(gen_id, finalize=True))["error_code"] == "busy"
    finally:
        release.set()
        result = await pending
    assert result["status"] == "completed"


async def test_stale_claim_can_be_taken_over(account, fake_drafts):
    gen_id = uuid.UUID((await start_draft(account))["generation_id"])
    now = datetime.now(timezone.utc)
    async with account.db() as db:
        draft = await db.get(Generation, gen_id)
        draft.render_metadata = {
            **draft.render_metadata, "client_claim": {"id": "external", "at": now.isoformat()},
        }
        await db.commit()
    submit = client_generation.submit_resume_draft_handler
    busy = await submit(str(gen_id), resume_json={"summary": "ready"})
    assert busy["error_code"] == "busy" and busy["submissions_used"] == 0
    async with account.db() as db:
        draft = await db.get(Generation, gen_id)
        draft.render_metadata = {
            **draft.render_metadata,
            "client_claim": {"id": "external", "at": (now - timedelta(minutes=6)).isoformat()},
        }
        await db.commit()
    completed = await submit(str(gen_id), resume_json={"summary": "ready"})
    assert completed["status"] == "completed" and completed["submissions_used"] == 1


@pytest.mark.parametrize("cap,latest_summary,chosen_revision", [(6, "worse", 2), (6, "overflow", 1), (2, "worse", 1)])
async def test_finalize_measures_revision_left_by_stale_claim(
    account, fake_drafts, monkeypatch, cap, latest_summary, chosen_revision,
):
    monkeypatch.setattr(settings, "OWN_MODEL_MAX_SUBMISSIONS", cap)
    gen_id = (await start_draft(account))["generation_id"]
    submit = client_generation.submit_resume_draft_handler
    first = await submit(gen_id, resume_json={"summary": "initial"})
    assert first["draft_revision"] == 1
    current = {"summary": latest_summary}
    async with account.db() as db:
        row = await db.get(Generation, uuid.UUID(gen_id))
        row.render_metadata = {
            **row.render_metadata,
            "client_draft": current,
            "client_draft_revision": 2,
            "client_submissions": 2,
            "client_claim": {"id": "crashed", "at": (datetime.now(timezone.utc) - timedelta(minutes=6)).isoformat()},
        }
        await db.commit()

    result = await submit(gen_id, finalize=True, expected_draft_revision=2)
    assert result["status"] == "completed" and result["draft_revision"] == 2
    assert fake_drafts.evaluate_draft.call_count == 2
    assert fake_drafts.evaluate_draft.call_args.kwargs["client_draft"] == current
    assert result["quality"]["finalized_draft_revision"] == chosen_revision
    assert result["quality"]["finalized_reason"] == ("submission_cap" if cap == 2 else "requested")
    assert result["resume_json"]["summary"] == (latest_summary if chosen_revision == 2 else "initial")


@pytest.mark.parametrize("change", ["delete", "pending_account", "revision", "staged_edit"])
async def test_editor_revalidates_before_upload(account, monkeypatch, change):
    metadata = {"profile": {"full_name": "Published"}, "tailored_resume": {"summary": "Published"}, "editor_revision": 3}
    gen_id = await add_generation(account, render_metadata=metadata)
    write_generation_artifacts(gen_id)
    uploads = Mock()
    monkeypatch.setattr(editor, "StorageService", Mock(return_value=SimpleNamespace(upload_bytes=uploads)))
    monkeypatch.setattr(editor, "fit_and_render_pdf", Mock(return_value=(
        b"%PDF-fake", SimpleNamespace(font_size=10, page_count=1, fits_target=True),
    )))
    sessions_opened = 0

    @asynccontextmanager
    async def change_before_publication():
        nonlocal sessions_opened
        sessions_opened += 1
        if sessions_opened == 2:
            async with account.db() as db:
                if change == "delete":
                    await generation_api.delete_generation(str(gen_id), account.user, db)
                elif change == "pending_account":
                    owner = await db.get(User, account.user.id)
                    owner.deletion_scheduled_for = datetime.now(timezone.utc) + timedelta(days=7)
                else:
                    row = await db.get(Generation, gen_id)
                    if change == "revision":
                        row.render_metadata = {**metadata, "editor_revision": 4}
                    else:
                        row.render_metadata = {**metadata, "edited_at": "changed"}
                await db.commit()
        async with account.db() as db:
            yield db

    monkeypatch.setattr(editor, "get_mcp_db", change_before_publication)
    result = await editor.render_resume_handler(str(gen_id), resume_json={"summary": "Edit"}, expected_revision=3)
    assert result["success"] is False
    uploads.assert_not_called()
    if change == "delete":
        assert "no longer available" in result["error"]
        assert not list((account.storage_dir / f"runs/{gen_id}").iterdir())
    elif change == "pending_account":
        assert result["error_code"] == "ACCOUNT_UNAVAILABLE"
    else:
        assert result["error_code"] == "REVISION_CONFLICT"
        assert result["current_revision"] == (4 if change == "revision" else 3)


async def test_reaper_abandonment_fresh_claim_and_conditional_update(account, fake_drafts, monkeypatch):
    capture = Mock()
    send_email = Mock()
    monkeypatch.setattr(generation_api, "capture_generation", capture)
    monkeypatch.setattr(generation_api, "send_completion_email", send_email)
    now = datetime.now(timezone.utc)
    old = now - timedelta(days=2)
    abandoned = uuid.UUID((await start_draft(account))["generation_id"])
    active = uuid.UUID((await start_draft(account))["generation_id"])
    changed = uuid.UUID((await start_draft(account))["generation_id"])
    abandoned_keys = write_generation_artifacts(abandoned)
    live_keys = write_generation_artifacts(active) + write_generation_artifacts(changed)

    async with account.db() as db:
        for gen_id in (abandoned, active, changed):
            row = await db.get(Generation, gen_id)
            row.updated_at = old
            if gen_id == active:
                row.render_metadata = {**row.render_metadata, "client_claim": {"id": "current", "at": now.isoformat()}}
        await db.commit()
        original_scalar = db.scalar

        async def refresh_before_update(statement, *args, **kwargs):
            if isinstance(statement, Update) and changed in statement.compile().params.values():
                await db.execute(update(Generation).where(Generation.id == changed).values(updated_at=now))
            return await original_scalar(statement, *args, **kwargs)

        monkeypatch.setattr(db, "scalar", refresh_before_update)
        await generation_api.reap_stuck_generations(db)
        row = await db.get(Generation, abandoned, populate_existing=True)
        assert row.status == "failed" and row.error_message == "Draft abandoned before submission."
        assert "client_brief" not in row.render_metadata and row.render_metadata["quality"]["requirements"]
        assert (await db.get(Generation, active, populate_existing=True)).status == "drafting"
        assert (await db.get(Generation, changed, populate_existing=True)).status == "drafting"
    assert all(not (account.storage_dir / key).exists() for key in abandoned_keys)
    assert all((account.storage_dir / key).is_file() for key in live_keys)
    assert [call.args[1] for call in capture.call_args_list] == ["abandoned"]
    send_email.assert_not_called()


async def test_abandonment_persists_only_failed_artifact_keys(account, fake_drafts, monkeypatch):
    gen_id = uuid.UUID((await start_draft(account))["generation_id"])
    keys = write_generation_artifacts(gen_id)
    failed_key = keys[1]
    delete_file = StorageService.delete_file
    monkeypatch.setattr(
        StorageService, "delete_file",
        lambda self, key: False if key == failed_key else delete_file(self, key),
    )
    async with account.db() as db:
        gen = await db.get(Generation, gen_id)
        gen.updated_at = datetime.now(timezone.utc) - timedelta(days=2)
        await db.commit()
        await generation_api.reap_abandoned_drafts(db)

    async with account.db() as db:
        gen = await db.get(Generation, gen_id)
        assert gen.status == "failed"
        task = (await db.scalars(select(AccountCleanupTask))).one()
        assert (task.kind, task.payload) == ("storage_objects", {"keys": [failed_key]})
    assert [key for key in keys if (account.storage_dir / key).is_file()] == [failed_key]


@pytest.mark.parametrize("admin", [False, True])
async def test_delete_generation_cleans_unrecorded_and_legacy_artifacts(account, monkeypatch, admin):
    gen_id = await add_generation(
        account, status="drafting", inference_source="client",
        pdf_storage_key="legacy/resume.pdf", md_storage_key="legacy/missing.md",
    )
    keys = write_generation_artifacts(gen_id, "legacy/resume.pdf")
    if admin:
        monkeypatch.setattr(settings, "ADMIN_EMAILS", account.user.email)
    path = f"/admin/generations/{gen_id}" if admin else f"/generate/{gen_id}"
    headers = web_session_headers(account.user)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        deleted = await client.delete(path, headers=headers)
    assert deleted.status_code == (200 if admin else 204)
    assert all(not (account.storage_dir / key).exists() for key in keys)
    async with account.db() as db:
        assert await db.get(Generation, gen_id) is None


async def test_client_routes_and_job_runner_reject_server_work(account, monkeypatch):
    completed = await add_generation(account, inference_source="client")
    failed = await add_generation(account, inference_source="client", status="failed")
    drafting = await add_generation(account, inference_source="client", status="drafting")
    monkeypatch.setattr(settings, "ADMIN_EMAILS", account.user.email)
    headers = auth_headers(account.user)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        replacement = await client.post(
            f"/generate/{completed}/replace-project", headers=headers,
            json={"profile_project_id": str(uuid.uuid4()), "target_project_index": 0, "current_resume": {}},
        )
        assert replacement.status_code == 409 and replacement.json()["detail"]["code"] == "client_built_resume"
        retry = await client.post(f"/admin/generations/{failed}/retry", headers=headers)
        assert retry.status_code == 409 and retry.json()["detail"]["code"] == "client_built_resume"
    assert (await editor.preview_resume_handler(str(drafting)))["status"] == "drafting"
    assert (await editor.render_resume_handler(str(drafting), resume_json={"summary": "Test"}))["status"] == "drafting"
    load_config = AsyncMock()
    monkeypatch.setattr(job_runner.llm_config_service, "load_from_db", load_config)
    await job_runner.run_generation(str(drafting))
    load_config.assert_not_awaited()


async def test_admin_usage_and_timings_only_include_server_runs(account, monkeypatch):
    monkeypatch.setattr(settings, "ADMIN_EMAILS", account.other.email)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    server = await add_generation(
        account, model_used="server model", created_at=now, completed_at=now + timedelta(seconds=12),
    )
    await add_generation(
        account, inference_source="client", model_used="client:assistant",
        created_at=now, completed_at=now + timedelta(minutes=2),
    )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver", headers=auth_headers(account.other),
    ) as client:
        credits = await client.get(f"/admin/users/{account.user.id}/credits")
        assert credits.json()["monthly_count"] == 1
        users = await client.get(f"/admin/users?search={account.user.email}")
        assert users.json()[0]["monthly_count"] == 1
        analytics = (await client.get("/admin/analytics")).json()
        assert analytics["total_generations"] == 2 and analytics["average_generation_latency_seconds"] == 12
        timing = (await client.get("/admin/metrics/timing-by-model")).json()
        assert [model["model_name"] for model in timing["models_benchmark"]] == ["server model"]
        assert [row["total_runs"] for row in timing["templates_benchmark"]] == [1]
        assert [run["id"] for run in timing["slowest_runs"]] == [str(server)]


async def test_rest_generation_stays_server_and_runner_persists_page_fill(account, monkeypatch):
    await set_own_model(account)
    trigger = AsyncMock()
    monkeypatch.setattr(generation_api, "trigger_pipeline", trigger)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.post(
            "/generate", headers=auth_headers(account.user),
            json={"template_id": "personal-classic", "job_description": "Build Python data APIs and write integration tests.", "send_email": False},
        )
    assert response.status_code == 200, response.text
    gen_id = response.json()["id"]
    trigger.assert_awaited_once_with(gen_id)
    monkeypatch.setattr(job_runner.llm_config_service, "load_from_db", AsyncMock())
    monkeypatch.setattr(job_runner.llm_config_service, "describe_primary", lambda role: "Test model")
    monkeypatch.setattr(job_runner, "compile_graph", lambda: SimpleNamespace(
        ainvoke=AsyncMock(return_value={"tailored_resume": {"summary": "Test"}, "page_fill_percent": 92.1}),
    ))
    await job_runner.run_generation(gen_id)
    async with account.db() as db:
        row = await db.get(Generation, uuid.UUID(gen_id))
        assert row.inference_source == "server" and row.status == "completed"
        assert row.render_metadata["page_fill_percent"] == 92.1
        assert (await db.get(UserRateLimit, account.user.id)).request_count == 1


async def test_local_storage_rejects_traversal_and_symlinks(account, tmp_path):
    storage = StorageService()
    assert storage.upload_bytes(b"test", "runs/one/resume.pdf")
    assert storage.download_bytes("runs/one/resume.pdf") == b"test"
    target = tmp_path / "outside"
    target.mkdir()
    (target / "secret.pdf").write_bytes(b"outside")
    (account.storage_dir / "symlink").symlink_to(target, target_is_directory=True)
    for key in ("../outside/secret.pdf", str(target / "secret.pdf"), "symlink/secret.pdf"):
        assert not storage.upload_bytes(b"new", key)
        assert storage.download_bytes(key) is None
        assert not storage.delete_file(key)
    assert (target / "secret.pdf").read_bytes() == b"outside"
    assert storage.delete_files(["runs/one/resume.pdf", "missing.pdf"]) == []
    assert not storage.file_exists("runs/one/resume.pdf")


@pytest.mark.parametrize("route", ["file", "download", "preview", "pdf-pages"])
@pytest.mark.parametrize("missing", [None, "font_size", "profile"])
async def test_client_pdf_fallback_uses_saved_layout(account, monkeypatch, route, missing):
    stored_profile = {"full_name": "Saved Header", "email": "saved@example.test"}
    stored_resume = {"summary": "Saved content"}
    metadata = {"profile": stored_profile, "font_size": 9.25, "tailored_resume": stored_resume}
    if missing:
        metadata.pop(missing)
    gen_id = await add_generation(account, inference_source="client", render_metadata=metadata)
    render_template = Mock(return_value="<html><body>Saved resume</body></html>")
    monkeypatch.setattr(TemplateRegistryService, "render_template", render_template)
    fit_and_render = Mock(side_effect=AssertionError("Client PDF fallback must use the saved font size"))
    monkeypatch.setattr(resume_render, "fit_and_render_pdf", fit_and_render)
    url = build_resume_file_link(gen_id) if route == "file" else f"/generate/{gen_id}/{route}"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.get(url, headers=auth_headers(account.user))

    fit_and_render.assert_not_called()
    if missing:
        assert response.status_code == 404 and response.json()["detail"] == "Saved resume layout is unavailable."
        render_template.assert_not_called()
    else:
        assert response.status_code == 200
        if route == "pdf-pages":
            assert response.json()["page_count"] == 1
        else:
            assert response.content.startswith(b"%PDF")
        render_template.assert_called_once()
        context = render_template.call_args.args[1]
        assert context["profile"] == stored_profile
        assert context["font_size"] == 9.25
        assert context["resume"] == stored_resume


async def test_own_model_brief_returns_mode_specific_wrap_estimate(account):
    from src.mcp.server import generate_resume

    await set_own_model(account)
    estimates = {}
    for mode in ("proper", "larp"):
        brief = await generate_resume("Build Python APIs", template_id="personal-classic", creativity_mode=mode)
        assert brief["status"] == "awaiting_draft"
        fit = brief["requirements"]["bullet_visible_chars"]
        assert set(fit) == {"target_min", "target_max", "wraps_above"}
        assert any(f"third line above about {fit['wraps_above']}" in rule for rule in brief["writing_rules"])
        resumed = await generation.get_generation_status_handler(brief["generation_id"], include_brief=True)
        assert resumed["requirements"]["bullet_visible_chars"] == fit
        estimates[mode] = fit["wraps_above"]
    assert estimates["proper"] > estimates["larp"]


async def test_own_model_real_render_and_file_download(account):
    from src.mcp.server import generate_resume, submit_resume_draft

    await set_own_model(account)
    start = await generate_resume("Build Python APIs", client_model="Real Test Model")
    assert start["status"] == "awaiting_draft"
    draft = {
        "job_analysis": {"job_title": "Backend Engineer", "company": "Example"},
        "summary": "Backend engineer building Python APIs and reliable data services.",
        "skills": {"Languages": ["Python"], "Databases": ["PostgreSQL"], "Tools": ["Docker", "pytest", "Git"]},
        "experiences": [
            {
                "source_id": f"exp_{slot}",
                "bullet_points": [
                    "Built a **FastAPI** service to index audited **PostgreSQL** records.",
                    "Added **pytest** coverage for API validation and deployment workflows.",
                ],
            }
            for slot in (1, 2)
        ],
        "projects": [
            {
                "source_id": f"proj_{slot}", "project_summary": "Data indexing", "description": "Search tool for archived records.",
                "technologies": ["Python", "PostgreSQL"],
                "bullet_points": [
                    "Wrote **PostgreSQL** queries for indexed search.", "Packaged the API with **Docker**.",
                ],
            }
            for slot in (1, 2)
        ],
        "extracurriculars": [],
    }
    first = await submit_resume_draft(start["generation_id"], resume_json=draft)
    assert first["status"] == "needs_revision", first
    assert first["layout"]["font_source"] == "fitted"
    assert first["layout"]["renders"] > 1 and first["layout"]["render_ms"] > 0

    summary = "Backend engineer building reliable Python APIs and PostgreSQL services."
    result = await submit_resume_draft(
        start["generation_id"],
        revisions=[{"path": "summary", "text": summary}],
        expected_draft_revision=first["draft_revision"],
        finalize=True,
    )
    assert result["status"] == "completed", result
    assert result["page_count"] == 1 and result["resume_json"]["summary"] == summary
    quality = result["quality"]
    assert quality["finalized_draft_revision"] == 2 and quality["font_source"] == "pinned"
    assert quality["has_horizontal_overflow"] is False
    assert quality["renders"] >= 1 and quality["render_ms"] > 0
    assert 0 < result["quality"]["page_fill_percent"] <= 100
    assert result["resume_json"]["experiences"][0]["organization"] == "Company 0"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        pdf = await client.get(result["download_url"])
        assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
        assert pdf.headers["content-type"] == "application/pdf"
        assert pdf.headers["content-disposition"].startswith('inline; filename="Alex_Developer_Backend_Engineer.pdf"')


async def test_invalid_batches_use_a_separate_allowance(account, fake_drafts, monkeypatch):
    monkeypatch.setattr(settings, "OWN_MODEL_MAX_SUBMISSIONS", 2)
    monkeypatch.setattr(settings, "OWN_MODEL_MAX_INVALID_SUBMISSIONS", 2)
    gen_id = (await start_draft(account))["generation_id"]
    submit = client_generation.submit_resume_draft_handler
    for _ in range(2):  # within the allowance: free
        rejected = await submit(gen_id, resume_json={})
        assert rejected["status"] == "invalid_draft" and rejected["submissions_used"] == 0
    over = await submit(gen_id, resume_json={})  # past the allowance: counts like any submission
    assert over["status"] == "invalid_draft" and over["submissions_used"] == 1
    fake_drafts.evaluate_draft.assert_not_called()


@pytest.mark.parametrize("use_revisions", [False, True])
async def test_invalid_batches_at_the_cap_never_render(account, fake_drafts, monkeypatch, use_revisions):
    monkeypatch.setattr(settings, "OWN_MODEL_MAX_SUBMISSIONS", 2)
    monkeypatch.setattr(settings, "OWN_MODEL_MAX_INVALID_SUBMISSIONS", 1)
    gen_id = (await start_draft(account))["generation_id"]
    submit = client_generation.submit_resume_draft_handler
    saved = await submit(gen_id, resume_json={"summary": "initial"})
    assert saved["status"] == "needs_revision" and saved["submissions_left"] == 1
    batch = {"resume_json": {}}
    if use_revisions:
        batch = {"revisions": [{"path": "unsupported", "text": "change"}]}
        monkeypatch.setattr(
            fake_drafts, "apply_revisions",
            lambda draft, _: (draft, [{"path": "unsupported", "code": "bad_path", "message": "Unsupported path."}]),
        )
    free = await submit(gen_id, **batch)
    assert free["status"] == "invalid_draft" and free["submissions_left"] == 1

    # An upload failure used to refund the last submission on each malformed batch.
    pdf_upload = Mock(return_value=False)
    with monkeypatch.context() as patch:
        patch.setattr(StorageService, "upload_bytes", pdf_upload)
        for finalize in (False, False, True):
            rejected = await submit(gen_id, finalize=finalize, **batch)
            assert rejected["status"] == "invalid_draft" and rejected["errors"] == free["errors"]
            assert rejected["submissions_used"] == 2 and rejected["submissions_left"] == 0
            assert rejected["client_draft"] == saved["client_draft"] and rejected["draft_revision"] == 1
            assert "No submissions are left" in rejected["next_step"] and "finalize=true" in rejected["next_step"]
    fake_drafts.evaluate_draft.assert_called_once()
    fake_drafts.finalize_draft.assert_not_called()
    pdf_upload.assert_not_called()
    assert (await submit(gen_id))["status"] == "invalid_draft"
    assert (await generation.get_generation_status_handler(gen_id))["last_report"]["status"] == "invalid_draft"

    completed = await submit(gen_id, finalize=True, expected_draft_revision=1)
    assert completed["status"] == "completed" and completed["submissions_used"] == 2
    assert completed["quality"]["finalized_draft_revision"] == 1
    fake_drafts.finalize_draft.assert_called_once()


async def test_final_attempt_falls_back_to_the_other_viable_revision(account, fake_drafts, monkeypatch):
    """A draft that keeps failing verification must not sink a viable later revision at the cap."""
    monkeypatch.setattr(settings, "OWN_MODEL_MAX_SUBMISSIONS", 2)
    gen_id = (await start_draft(account))["generation_id"]
    submit = client_generation.submit_resume_draft_handler
    await submit(gen_id, resume_json={"summary": "initial"})
    finalize = fake_drafts.finalize_draft.side_effect

    def fail_initial(**kwargs):
        if kwargs["tailored_resume"] == {"summary": "initial"}:
            raise draft_service.FinalizeUnverified("Could not verify layout")
        return finalize(**kwargs)

    fake_drafts.finalize_draft.side_effect = fail_initial
    for _ in range(2):  # two refunded failures on revision 1
        assert (await submit(gen_id, finalize=True))["error_code"] == "DRAFT_RENDER_FAILED"
    saved = await submit(gen_id, resume_json={"summary": "worse"})  # viable revision 2, at the cap
    assert saved["status"] == "completed"
    assert saved["quality"]["finalized_draft_revision"] == 2
    assert saved["resume_json"] == {"summary": "worse"}
