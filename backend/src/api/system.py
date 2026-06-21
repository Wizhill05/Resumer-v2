from fastapi import APIRouter

router = APIRouter(tags=["system"])


@router.get("/system/health")
async def health():
    return {"status": "ok"}
