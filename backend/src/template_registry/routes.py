from fastapi import APIRouter
from src.schemas.template import TemplateManifest
from src.template_registry.service import TemplateRegistryService

router = APIRouter(prefix="/templates", tags=["templates"])


@router.get("", response_model=list[TemplateManifest])
async def list_templates():
    return TemplateRegistryService.list_templates()
