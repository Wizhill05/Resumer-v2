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
from src.core.storage import StorageService
from src.api import profile, generation, system, imports, guest, admin, feedback, oauth
from src.core.oauth import ensure_oauth_schema
from src.services.llm_config import ensure_llm_provider_schema, llm_config_service
from src.template_registry import router as template_router
from src.services.import_jobs import cleanup_old_jobs
from src.mcp.server import mcp_server, get_mcp_app

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail-fast config validation — refuse to start on misconfiguration.
    if not settings.JWT_SECRET:
        raise RuntimeError("JWT_SECRET is not set. Generate one and set it in env / Secret Manager.")
    if settings.JWT_SECRET == "changeme":
        raise RuntimeError("JWT_SECRET is still the default 'changeme'. Rotate before running.")
    if not settings.openrouter_api_keys:
        raise RuntimeError("OPENROUTER_API_KEYS is not set. Set at least one key in env.")
    if not settings.google_api_keys:
        raise RuntimeError("GOOGLE_API_KEYS is not set. Set at least one fallback key in env.")

    # Idempotently ensure R2 bucket has a 90-day lifecycle expiry rule.
    StorageService().ensure_lifecycle_policy()

    # Idempotently ensure OAuth tables and columns exist in PostgreSQL.
    await ensure_oauth_schema()

    # Idempotently ensure LLM provider config schema and user pro tier exist.
    await ensure_llm_provider_schema()
    await llm_config_service.load_from_db()
    cleanup_task = asyncio.create_task(cleanup_old_jobs())
    try:
        mcp_server.session_manager._has_started = False
        async with mcp_server.session_manager.run():
            yield
    finally:
        mcp_server.session_manager._has_started = False

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
app.include_router(feedback.router)
app.include_router(oauth.router)

# Remote MCP Sub-application (Streamable HTTP + SSE)
app.mount("", get_mcp_app())
