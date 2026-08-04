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
from src.api import profile, generation, system, imports, guest, admin, feedback
from src.template_registry import router as template_router
from src.services.import_jobs import cleanup_old_jobs


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail-fast config validation — refuse to start on misconfiguration.
    if not settings.JWT_SECRET:
        raise RuntimeError("JWT_SECRET is not set. Generate one and set it in env / Secret Manager.")
    if settings.JWT_SECRET == "changeme":
        raise RuntimeError("JWT_SECRET is still the default 'changeme'. Rotate before running.")
    if not settings.cerebras_api_keys:
        raise RuntimeError("CEREBRAS_API_KEYS is not set. Set at least one key in env.")
    if not settings.google_api_keys:
        raise RuntimeError("GOOGLE_API_KEYS is not set. Set at least one fallback key in env.")

    # Idempotently ensure R2 bucket has a 90-day lifecycle expiry rule.
    StorageService().ensure_lifecycle_policy()

    # Ephemeral import jobs cleanup loop
    cleanup_task = asyncio.create_task(cleanup_old_jobs())

    yield

    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Resumer API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
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
