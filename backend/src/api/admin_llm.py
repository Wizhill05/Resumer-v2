from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.auth import get_current_admin
from src.core.database import get_db
from src.schemas.llm import (
    LlmEndpointCreate,
    LlmEndpointUpdate,
    LlmProbeRequest,
    LlmRoleUpdate,
    LlmTestRequest,
)
from src.services.llm_config import ConflictError, llm_config_service

router = APIRouter(prefix="/admin/llm", tags=["admin-llm"], dependencies=[Depends(get_current_admin)])


def _validation_error(message: str, field: str | None = None) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"code": "validation_error", "message": message, "field": field},
    )


def _not_found(message: str = "Not found") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"code": "not_found", "message": message},
    )


@router.get("/config")
async def get_llm_config(db: AsyncSession = Depends(get_db)):
    return await llm_config_service.list_config(db)


@router.post("/endpoints", status_code=status.HTTP_201_CREATED)
async def create_endpoint(data: LlmEndpointCreate, db: AsyncSession = Depends(get_db)):
    try:
        return await llm_config_service.create_endpoint(db, data)
    except ConflictError as exc:
        detail: dict = {"code": exc.code, "message": exc.message}
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from None
    except ValueError as exc:
        raise _validation_error(str(exc), getattr(exc, "field", None)) from None


@router.patch("/endpoints/{endpoint_id}")
async def update_endpoint(endpoint_id: uuid.UUID, data: LlmEndpointUpdate, db: AsyncSession = Depends(get_db)):
    try:
        return await llm_config_service.update_endpoint(db, endpoint_id, data)
    except LookupError as exc:
        raise _not_found(str(exc)) from None
    except ConflictError as exc:
        detail: dict = {"code": exc.code, "message": exc.message}
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from None
    except ValueError as exc:
        raise _validation_error(str(exc), getattr(exc, "field", None)) from None


@router.delete("/endpoints/{endpoint_id}")
async def delete_endpoint(
    endpoint_id: uuid.UUID,
    force: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    try:
        removed = await llm_config_service.delete_endpoint(db, endpoint_id, force)
    except LookupError as exc:
        raise _not_found(str(exc)) from None
    except ConflictError as exc:
        detail: dict = {"code": exc.code, "message": exc.message, "roles": list(exc.roles or [])}
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from None
    return {"deleted": True, "removed_from_roles": removed}


@router.post("/endpoints/{endpoint_id}/models/refresh")
async def refresh_models(endpoint_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    try:
        return await llm_config_service.refresh_models(db, endpoint_id)
    except LookupError as exc:
        raise _not_found(str(exc)) from None


@router.post("/endpoints/{endpoint_id}/test")
async def test_endpoint(endpoint_id: uuid.UUID, data: LlmTestRequest, db: AsyncSession = Depends(get_db)):
    try:
        return await llm_config_service.test_endpoint(db, endpoint_id, data.model, data.prompt)
    except LookupError as exc:
        raise _not_found(str(exc)) from None


@router.post("/probe")
async def probe(data: LlmProbeRequest, db: AsyncSession = Depends(get_db)):
    try:
        return await llm_config_service.probe(db, data)
    except LookupError as exc:
        raise _not_found(str(exc)) from None


@router.put("/roles/{role}")
async def update_role(role: str, data: LlmRoleUpdate, db: AsyncSession = Depends(get_db)):
    try:
        return await llm_config_service.update_role(db, role, data)
    except LookupError as exc:
        raise _not_found(str(exc)) from None
    except ValueError as exc:
        raise _validation_error(str(exc), getattr(exc, "field", None)) from None
