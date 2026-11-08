import logging
import sys
import asyncio
from contextlib import asynccontextmanager

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    try:
        import uvicorn.loops.asyncio
        import uvicorn.loops.auto
        uvicorn.loops.asyncio.asyncio_loop_factory = lambda use_subprocess=False: asyncio.SelectorEventLoop
        uvicorn.loops.auto.auto_loop_factory = lambda use_subprocess=False: asyncio.SelectorEventLoop
    except ImportError:
        pass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.core.config import settings
from src.core.analytics import shutdown_analytics
from src.api import profile, generation, system, imports, guest, admin, feedback, oauth, files, auth, admin_llm, internal_auth, integrations_github
from src.core.oauth import ensure_oauth_schema
from src.core.database import AsyncSessionLocal
from src.services.llm_config import ensure_llm_schema, llm_config_service
from src.template_registry import router as template_router
from src.services.import_jobs import cleanup_old_jobs
from src.mcp.server import mcp_server, get_mcp_app

logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail-fast config validation — refuse to start on misconfiguration.
    if not settings.JWT_SECRET:
        raise RuntimeError("JWT_SECRET is not set. Generate one and set it in env / Secret Manager.")
    if settings.JWT_SECRET == "changeme":
        raise RuntimeError("JWT_SECRET is still the default 'changeme'. Rotate before running.")

    # Idempotently ensure OAuth tables and columns exist in PostgreSQL.
    await ensure_oauth_schema()

    # Idempotently ensure LLM schema.
    await ensure_llm_schema()
    try:
        async with AsyncSessionLocal() as s:
            await llm_config_service.bootstrap_from_env(s)
    except Exception as exc:  # noqa: BLE001 - never block startup on optional LLM bootstrap
        logger.warning("[startup] LLM bootstrap skipped (%s). Configure endpoints in Admin → LLM Endpoints.", type(exc).__name__)
    await llm_config_service.load_from_db()
    if not llm_config_service.resolve_targets("default"):
        logger.warning("[startup] No LLM endpoint configured for role 'default'.")
    cleanup_task = asyncio.create_task(cleanup_old_jobs())
    try:
        mcp_server.session_manager._has_started = False
        async with mcp_server.session_manager.run():
            yield
    finally:
        mcp_server.session_manager._has_started = False
        await asyncio.to_thread(shutdown_analytics)

    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Resumer API", version="2.0.0", lifespan=lifespan)

cors_origins = [settings.FRONTEND_URL]
for o in ["https://chatgpt.com", "https://chat.openai.com", "https://gemini.google.com", "http://localhost:3000"]:
    if o not in cors_origins:
        cors_origins.append(o)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(system.router)
app.include_router(profile.router)
app.include_router(imports.router)
app.include_router(generation.router)
app.include_router(guest.router)
app.include_router(template_router)
app.include_router(admin.router)
app.include_router(admin_llm.router)
app.include_router(feedback.router)
app.include_router(oauth.router)
app.include_router(files.router)
app.include_router(auth.router)
app.include_router(internal_auth.router)
app.include_router(integrations_github.router)

# Remote MCP Sub-application (Streamable HTTP + SSE)
app.mount("", get_mcp_app())
