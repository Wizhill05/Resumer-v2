from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "postgresql+psycopg://user:pass@localhost/resumer"
    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"

    R2_ENDPOINT_URL: str = ""
    R2_ACCESS_KEY_ID: str = ""
    R2_SECRET_ACCESS_KEY: str = ""
    R2_BUCKET_NAME: str = "resumer-artifacts"

    GOOGLE_API_KEY: str = ""

    FRONTEND_URL: str = "http://localhost:3000"

    RESEND_API_KEY: str = ""
    NOTIFICATION_FROM_EMAIL: str = "Resumer <noreply@resumer.app>"

    # Pipeline execution: "local" runs in-process (dev); "cloudrun_job" triggers a Cloud Run Job (prod).
    EXECUTION_MODE: str = "local"
    CLOUD_RUN_JOB_NAME: str = "resumer-pipeline"
    CLOUD_RUN_JOB_REGION: str = "us-central1"
    GCP_PROJECT_ID: str = ""
    CLOUD_RUN_TASK_TIMEOUT_SECONDS: int = 1800

    # Absolute path to backend directory resolved relative to this file
    BACKEND_DIR: Path = Path(__file__).resolve().parent.parent.parent
    TEMPLATES_DIR: Path = BACKEND_DIR / "templates"


settings = Settings()
