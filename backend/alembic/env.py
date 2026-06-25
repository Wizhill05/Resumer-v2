from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

# Import all models so autogenerate detects them
from src.models.user import Base  # noqa: F401
from src.models.profile import Profile, UserProject, UserExperience, UserEducation  # noqa: F401
from src.models.generation import Generation, GenerationLog, UserRateLimit  # noqa: F401
from src.core.config import settings

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Use sync URL for alembic (strip async driver prefix)
sync_url = settings.DATABASE_URL
for prefix, replacement in [
    ("postgresql+psycopg://", "postgresql+psycopg2://"),
    ("postgres://", "postgresql+psycopg2://"),
]:
    if sync_url.startswith(prefix):
        sync_url = sync_url.replace(prefix, replacement, 1)
        break

config.set_main_option("sqlalchemy.url", sync_url)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
