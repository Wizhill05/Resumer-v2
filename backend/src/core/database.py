from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.core.config import settings

# Force async psycopg3 driver scheme if user provided standard postgres URL
db_url = settings.DATABASE_URL
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+psycopg://", 1)
elif db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)

engine = create_async_engine(
    db_url,
    echo=False,
    pool_pre_ping=True,  # re-validates connections after Neon autosuspend cold-wake
    pool_recycle=1800,  # recycle before Neon's 5-min idle disconnect kills the conn
    pool_size=5,  # free tier: keep at most 5 persistent connections
    max_overflow=10,  # 10 burst connections beyond pool_size on free tier
    connect_args={
        "connect_timeout": 10
    },  # fail fast on Neon cold-wake (default is infinite)
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
