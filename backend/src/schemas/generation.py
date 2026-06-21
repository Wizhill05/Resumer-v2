import uuid
from datetime import datetime

from pydantic import BaseModel


class GenerationCreate(BaseModel):
    template_id: str
    job_description: str
    job_title: str | None = None
    company: str | None = None
    keywords: list[str] | None = None
    instructions: str | None = None
    model_used: str = "gemma-4"


class GenerationOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    template_id: str
    job_title: str | None
    company: str | None
    status: str
    model_used: str
    created_at: datetime
    completed_at: datetime | None

    model_config = {"from_attributes": True}
