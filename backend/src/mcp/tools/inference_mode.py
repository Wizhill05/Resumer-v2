from typing import Any

from fastapi import HTTPException

from src.api.generation import daily_generation_quota, generation_caps
from src.api.inference_mode import create_challenge, mode_response, set_account_mode
from src.core.config import settings
from src.mcp.context import account_unavailable, get_current_mcp_user, get_mcp_db
from src.models.user import User


async def get_inference_mode_handler() -> dict[str, Any]:
    from src.services.client_draft import max_submissions

    async with get_mcp_db() as db:
        user = await db.get(User, get_current_mcp_user().id)
        if user is None or user.is_pending_deletion:
            return account_unavailable()
        daily_cap, _ = await generation_caps(user, db)
        return {
            **mode_response(user).model_dump(mode="json"),
            "modes": {
                "resumer": {"description": "Resumer writes and renders the resume using your generation quota."},
                "own_model": {"description": "Your assistant writes the resume. Resumer fits and renders the PDF."},
            },
            "daily_quota": await daily_generation_quota(user, db, daily_cap),
            "own_model_limits": {
                "daily_drafts": settings.OWN_MODEL_DAILY_DRAFT_CAP,
                "max_submissions_per_resume": max_submissions(),
            },
            "how_to_change": "Call set_inference_mode when the user asks to switch.",
        }


async def set_inference_mode_handler(mode: str) -> dict[str, Any]:
    if mode not in {"resumer", "own_model"}:
        return {
            "success": False, "status": "error", "error_code": "INVALID_INFERENCE_MODE",
            "error": "Choose resumer or own_model.",
        }

    user_id = get_current_mcp_user().id
    try:
        async with get_mcp_db() as db:
            if mode == "resumer":
                result = await set_account_mode(db, user_id, "resumer", via="mcp")
                return {"success": True, "status": "updated", **result.model_dump(mode="json")}
            token = await create_challenge(db, user_id)
    except HTTPException as exc:
        if exc.status_code == 404:
            return account_unavailable()
        raise

    return {
        "success": True,
        "status": "confirmation_required",
        "explain_to_user": (
            "Your assistant's model will write the resume text. Resumer will still render, fit, and check "
            "it. These builds don't use your Resumer daily quota. Writing quality depends on your "
            "assistant's model, and you can switch back anytime. To enable it, open the link in your "
            "browser, sign in to Résumer if prompted, and press the confirmation button."
        ),
        "confirm_url": f"{settings.FRONTEND_URL.rstrip('/')}/connect/own-model#c={token}",
        "assistant_instructions": (
            "Show the explanation and the full link, including its #c= fragment, to the user. "
            "They must open it in a browser where they "
            "are signed in to Résumer, or sign in when prompted, and press the confirmation button. "
            "Never open or fetch the link yourself. After the user confirms, call get_inference_mode."
        ),
    }
