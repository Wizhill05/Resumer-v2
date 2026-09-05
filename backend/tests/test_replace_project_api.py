import pytest
from uuid import uuid4
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import HTTPException

from src.schemas.generation import ReplaceProjectRequest
from src.api.generation import replace_project_for_editor


@pytest.mark.asyncio
async def test_replace_project_endpoint_project_not_found(monkeypatch):
    mock_user = MagicMock()
    mock_user.id = uuid4()

    mock_gen = MagicMock()
    mock_gen.id = uuid4()
    mock_gen.template_id = "personal-classic"
    mock_gen.render_metadata = {"editor_revision": 1, "tailored_resume": {"projects": []}}

    # Mock _get_completed_gen_for_editor
    async def mock_get_gen(*args, **kwargs):
        return mock_gen

    monkeypatch.setattr("src.api.generation._get_completed_gen_for_editor", mock_get_gen)

    # Mock db to return None for UserProject
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_db.execute.return_value = mock_result

    req = ReplaceProjectRequest(
        target_project_index=0,
        profile_project_id=uuid4(),
        current_resume={"projects": [{"name": "P1"}]},
    )

    with pytest.raises(HTTPException) as exc:
        await replace_project_for_editor(
            gen_id=str(mock_gen.id),
            data=req,
            current_user=mock_user,
            db=mock_db,
        )
    assert exc.value.status_code == 404
    assert "Profile project not found" in exc.value.detail


@pytest.mark.asyncio
async def test_replace_project_endpoint_invalid_target_index(monkeypatch):
    mock_user = MagicMock()
    mock_user.id = uuid4()

    mock_gen = MagicMock()
    mock_gen.id = uuid4()
    mock_gen.render_metadata = {"editor_revision": 1}

    async def mock_get_gen(*args, **kwargs):
        return mock_gen

    monkeypatch.setattr("src.api.generation._get_completed_gen_for_editor", mock_get_gen)

    mock_project = MagicMock()
    mock_project.id = uuid4()
    mock_project.user_id = mock_user.id

    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = mock_project
    mock_db.execute.return_value = mock_result

    req = ReplaceProjectRequest(
        target_project_index=5,  # Out of bounds
        profile_project_id=mock_project.id,
        current_resume={"projects": [{"name": "P1"}]},
    )

    with pytest.raises(HTTPException) as exc:
        await replace_project_for_editor(
            gen_id=str(mock_gen.id),
            data=req,
            current_user=mock_user,
            db=mock_db,
        )
    assert exc.value.status_code == 400
    assert "Invalid target_project_index" in exc.value.detail


@pytest.mark.asyncio
async def test_replace_project_endpoint_success(monkeypatch):
    mock_user = MagicMock()
    mock_user.id = uuid4()

    mock_gen = MagicMock()
    mock_gen.id = uuid4()
    mock_gen.render_metadata = {"editor_revision": 1, "profile": {"full_name": "Test User"}}

    async def mock_get_gen(*args, **kwargs):
        return mock_gen

    monkeypatch.setattr("src.api.generation._get_completed_gen_for_editor", mock_get_gen)

    mock_project = MagicMock()
    mock_project.id = uuid4()
    mock_project.user_id = mock_user.id
    mock_project.name = "Replacement Project"

    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = mock_project
    mock_db.execute.return_value = mock_result

    # Mock run_background_replace_project
    async def mock_background(*args, **kwargs):
        pass

    monkeypatch.setattr("src.services.resume_retailor.run_background_replace_project", mock_background)

    req = ReplaceProjectRequest(
        target_project_index=0,
        profile_project_id=mock_project.id,
        current_resume={"projects": [{"name": "Old Project"}]},
    )

    res = await replace_project_for_editor(
        gen_id=str(mock_gen.id),
        data=req,
        current_user=mock_user,
        db=mock_db,
    )

    assert res.success is True
    assert res.status == "remaking_project"
    assert res.generation_id == str(mock_gen.id)
    assert mock_gen.status == "remaking_project"
    assert mock_db.commit.called
