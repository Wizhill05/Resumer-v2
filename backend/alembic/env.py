from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

# Import all models so autogenerate detects them
from src.models.user import Base  # noqa: F401
from src.models.profile import Profile, UserProject, UserExperience, UserEducation  # noqa: F401
from src.models.generation import (  # noqa: F401
    Generation,
    GenerationLog,
    GuestRateLimit,
    PromptConfig,
    UserRateLimit,
    SupportReport,
    ReportAttachment,
    FeedbackRating,
)
from src.models.oauth import (  # noqa: F401
    OAuthClient,
    OAuthAuthorizationCode,
    OAuthRefreshToken,
)
from src.core.config import settings

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Use sync URL for alembic (strip async driver prefix)
sync_url = settings.DATABASE_URL
for prefix, replacement in [
    ("postgresql+psycopg://", "postgresql+psycopg://"),
    ("postgres://", "postgresql+psycopg://"),
    ("postgresql://", "postgresql+psycopg://"),
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
    alembic_config = config.get_section(config.config_ini_section, {})
    alembic_config["sqlalchemy.url"] = config.get_main_option("sqlalchemy.url")
    connectable = engine_from_config(
        alembic_config,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        # Sanitize alembic_version table to prevent overlapping/duplicate heads in Railway DB
        try:
            from sqlalchemy import text
            res = connection.execute(text("SELECT version_num FROM alembic_version")).fetchall()
            versions = [r[0] for r in res if r and r[0]]
            if len(versions) > 1:
                latest = "a2c4e6f8b0d2" if "a2c4e6f8b0d2" in versions else versions[-1]
                connection.execute(text("DELETE FROM alembic_version"))
                connection.execute(text("INSERT INTO alembic_version (version_num) VALUES (:v)"), {"v": latest})
                connection.commit()
        except Exception:
            pass

        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
