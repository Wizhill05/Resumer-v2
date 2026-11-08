"""GenerationOut.pdf_version keys the frontend's on-device PDF cache."""
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from src.schemas.generation import GenerationOut


def _gen(render_metadata):
    return SimpleNamespace(
        id=uuid.uuid4(), user_id=uuid.uuid4(), template_id="personal-classic",
        job_title=None, company=None, status="completed", model_used="m",
        job_description="jd", created_at=datetime.now(timezone.utc), completed_at=None,
        thumb_storage_key=None, content_split=None, send_email=None,
        creativity_mode=None, section_order=None, render_metadata=render_metadata,
    )


def test_pdf_version_follows_editor_revision_and_hides_metadata():
    out = GenerationOut.model_validate(_gen({"editor_revision": 4, "tailored_resume": {"x": 1}}))
    body = out.model_dump(mode="json")
    assert body["pdf_version"] == 4
    assert "render_metadata" not in body


def test_pdf_version_defaults_to_zero_before_any_edit():
    assert GenerationOut.model_validate(_gen(None)).pdf_version == 0
    assert GenerationOut.model_validate(_gen({"tailored_resume": {}})).pdf_version == 0
