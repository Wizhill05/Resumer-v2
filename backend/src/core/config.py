import json
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _parse_keys(raw: str | None) -> list[str]:
    """Accept bare comma-separated string or JSON array string."""
    if not raw:
        return []
    raw = raw.strip()
    if raw.startswith("["):
        try:
            return [str(k).strip() for k in json.loads(raw) if str(k).strip()]
        except json.JSONDecodeError:
            pass
    return [k.strip() for k in raw.split(",") if k.strip()]


BACKEND_DIR: Path = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(BACKEND_DIR / ".env", ".env"),
        extra="ignore"
    )

    ENVIRONMENT: str = "development"
    DATABASE_URL: str = "postgresql+psycopg://user:pass@localhost/resumer"
    JWT_SECRET: str = "changeme"
    JWT_ALGORITHM: str = "HS256"
    INTERNAL_API_SECRET: str = ""
    GITHUB_TOKEN_KEY: str = ""
    GITHUB_CONNECT_CLIENT_ID: str = ""
    GITHUB_CONNECT_CLIENT_SECRET: str = ""
    GITHUB_CONNECT_REDIRECT_URI: str = "https://resumer.buzz/api/integrations/github/callback"

    R2_ENDPOINT_URL: str = ""
    R2_ACCESS_KEY_ID: str = ""
    R2_SECRET_ACCESS_KEY: str = ""
    R2_BUCKET_NAME: str = "resumer-artifacts"

    LLM_SECRET_KEY: str = ""
    LLM_BOOTSTRAP_NAME: str = "Primary"
    LLM_BOOTSTRAP_BASE_URL: str = ""
    LLM_BOOTSTRAP_API_KEY: str = ""
    LLM_BOOTSTRAP_MODEL: str = ""
    LLM_CONFIG_REFRESH_SECONDS: int = 30
    LLM_MAX_OUTPUT_TOKENS: int = Field(default=8192, ge=256, le=32768)
    FRONTEND_URL: str = "http://localhost:3000"
    BACKEND_URL: str = ""
    FILE_LINK_TTL_HOURS: int = 168  # 7 days default
    ADMIN_EMAILS: str = "admin@example.com,user@example.com"
    DEFAULT_DAILY_CAP: int = 5
    DEFAULT_MONTHLY_CAP: int = 150

    @property
    def admin_emails(self) -> list[str]:
        return _parse_keys(self.ADMIN_EMAILS)

    RESEND_API_KEY: str = ""
    NOTIFICATION_FROM_EMAIL: str = "Resumer <noreply@aryansingh.space>"
    SUPPORT_WEBHOOK_URL: str = ""
    TURNSTILE_SECRET_KEY: str = ""
    VAPID_PUBLIC_KEY: str = ""
    VAPID_PRIVATE_KEY: str = ""
    VAPID_SUBJECT: str = "mailto:noreply@resumer.buzz"
    SUPPORT_TICKET_HOURLY_USER: int = 10
    SUPPORT_REPLY_HOURLY_USER: int = 60
    SUPPORT_TICKET_HOURLY_GUEST_COOKIE: int = 5
    SUPPORT_TICKET_HOURLY_GUEST_IP: int = 20
    SUPPORT_REPLY_HOURLY_GUEST_COOKIE: int = 30
    SUPPORT_REPLY_HOURLY_GUEST_IP: int = 100
    SUPPORT_TICKET_HOURLY_GUEST_UNTRUSTED: int = 30
    SUPPORT_REPLY_HOURLY_GUEST_UNTRUSTED: int = 120
    SUPPORT_REPLY_HOURLY_GUEST_REPORT: int = 30
    GUEST_GENERATE_DAILY_PER_IP: int = 10
    GUEST_IMPORT_DAILY_PER_IP: int = 15
    GUEST_IMPORT_DAILY_PER_TOKEN: int = 10
    GUEST_DAILY_GLOBAL_CAP: int = 300
    GUEST_TURNSTILE_REQUIRED: bool = False

    EXECUTION_MODE: str = "local"
    POSTHOG_PROJECT_TOKEN: str = ""
    POSTHOG_HOST: str = "https://us.i.posthog.com"
    POSTHOG_ENVIRONMENT: str = "development"
    # Read access for the admin overview. A personal API key (scope: query:read) and the
    # numeric project id; the project token above can only send events.
    POSTHOG_PERSONAL_API_KEY: str = ""
    POSTHOG_PROJECT_ID: str = ""
    POSTHOG_API_HOST: str = ""

    # Feature flags
    ENABLE_RESUME_EDITOR: bool = True

    BACKEND_DIR: Path = Path(__file__).resolve().parent.parent.parent
    TEMPLATES_DIR: Path = BACKEND_DIR / "templates"


settings = Settings()
