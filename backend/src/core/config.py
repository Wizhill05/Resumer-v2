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


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "postgresql+psycopg://user:pass@localhost/resumer"
    JWT_SECRET: str = "changeme"
    JWT_ALGORITHM: str = "HS256"

    R2_ENDPOINT_URL: str = ""
    R2_ACCESS_KEY_ID: str = ""
    R2_SECRET_ACCESS_KEY: str = ""
    R2_BUCKET_NAME: str = "resumer-artifacts"

    # Stored as raw string; parsed via property so pydantic-settings never
    # tries json.loads on a bare comma-separated value like "key1,key2".
    OPENROUTER_API_KEYS: str = Field(default="", alias="OPENROUTER_API_KEYS")
    GOOGLE_API_KEYS: str = Field(default="", alias="GOOGLE_API_KEYS")

    FREE_MODEL_NAME: str = "poolside/laguna-xs-2.1:free"
    FREE_MODEL_BASE_URL: str = "https://openrouter.ai/api/v1"

    PRO_MODEL_NAME: str = "antigravity/gemini-3.7-flash-tiered"
    PRO_MODEL_BASE_URL: str = "https://omniroute-latest-rmm0.onrender.com/"
    PRO_MODEL_API_KEY: str = ""

    @property
    def openrouter_api_keys(self) -> list[str]:
        return _parse_keys(self.OPENROUTER_API_KEYS)

    @property
    def google_api_keys(self) -> list[str]:
        return _parse_keys(self.GOOGLE_API_KEYS)

    FRONTEND_URL: str = "http://localhost:3000"
    BACKEND_URL: str = ""

    ADMIN_EMAILS: str = "admin@example.com,user@example.com"
    DEFAULT_DAILY_CAP: int = 5
    DEFAULT_MONTHLY_CAP: int = 150

    @property
    def admin_emails(self) -> list[str]:
        return _parse_keys(self.ADMIN_EMAILS)

    RESEND_API_KEY: str = ""
    NOTIFICATION_FROM_EMAIL: str = "Resumer <noreply@aryansingh.space>"
    SUPPORT_WEBHOOK_URL: str = ""

    EXECUTION_MODE: str = "local"

    # Feature flags
    ENABLE_RESUME_EDITOR: bool = True

    BACKEND_DIR: Path = Path(__file__).resolve().parent.parent.parent
    TEMPLATES_DIR: Path = BACKEND_DIR / "templates"


settings = Settings()
