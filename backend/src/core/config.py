from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "postgresql+psycopg://user:pass@localhost/resumer"
    JWT_SECRET: str = "changeme"
    JWT_ALGORITHM: str = "HS256"

    R2_ENDPOINT_URL: str = ""
    R2_ACCESS_KEY_ID: str = ""
    R2_SECRET_ACCESS_KEY: str = ""
    R2_BUCKET_NAME: str = "resumer-artifacts"

    FRONTEND_URL: str = "http://localhost:3000"

    # Absolute path to backend directory resolved relative to this file
    BACKEND_DIR: Path = Path(__file__).resolve().parent.parent.parent
    TEMPLATES_DIR: Path = BACKEND_DIR / "templates"


settings = Settings()
