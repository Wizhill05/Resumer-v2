from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.core.config import settings
from src.api import profile, generation, system
from src.template_registry import router as template_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


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
app.include_router(generation.router)
app.include_router(template_router)
