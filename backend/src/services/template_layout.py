from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Sequence
from fastapi import HTTPException, status

from src.core.config import settings
from src.models.user import User
from src.schemas.template import (
    DEFAULT_SECTION_ORDER,
    SECTION_IDS,
    TemplateManifest,
)


def validate_section_order(
    section_order: Any,
    supported_sections: Sequence[str] = SECTION_IDS,
) -> list[str]:
    """Validate that section_order is an exact permutation of supported_sections.

    Raises HTTPException(422) for:
    - non-list / non-sequence input
    - duplicate section IDs
    - unknown section IDs
    - missing section IDs
    - extra section IDs
    """
    if section_order is None or not isinstance(section_order, (list, tuple)):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="section_order must be a list of section identifiers",
        )

    expected_set = set(supported_sections)
    if len(section_order) != len(expected_set):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"section_order must contain exactly {len(expected_set)} sections, "
                f"got {len(section_order)}"
            ),
        )

    seen: set[str] = set()
    for sid in section_order:
        if not isinstance(sid, str):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid section identifier type: {type(sid).__name__}",
            )
        if sid not in expected_set:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"Unknown section identifier '{sid}'. "
                    f"Supported section IDs: {sorted(expected_set)}"
                ),
            )
        if sid in seen:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Duplicate section identifier '{sid}'",
            )
        seen.add(sid)

    missing = expected_set - seen
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Missing required section identifiers: {sorted(missing)}",
        )

    return list(section_order)


def resolve_section_order(
    explicit_order: Sequence[str] | None = None,
    user: User | None = None,
    template_id: str = "personal-classic",
    manifest: TemplateManifest | None = None,
) -> list[str]:
    """Resolve section order by precedence:
    1. Explicit requested order (if provided and valid)
    2. User's saved preference for this template
    3. Template's default section order
    4. Historical default section order
    """
    if manifest is None:
        from src.template_registry.service import TemplateRegistryService
        manifest = TemplateRegistryService.get_template_manifest(template_id)

    supported = (
        manifest.default_section_order
        if manifest and manifest.default_section_order
        else DEFAULT_SECTION_ORDER
    )

    # 1. Explicit requested order
    if explicit_order is not None:
        return validate_section_order(explicit_order, supported)

    # 2. Saved user preference for this template
    if user and user.preferred_section_orders:
        pref = user.preferred_section_orders.get(template_id)
        if pref:
            try:
                return validate_section_order(pref, supported)
            except HTTPException:
                pass

    # 3. Template default
    if manifest and manifest.default_section_order:
        return list(manifest.default_section_order)

    # 4. Historical default
    return list(DEFAULT_SECTION_ORDER)


def get_generation_section_order(
    generation_section_order: Sequence[str] | None,
    template_id: str = "personal-classic",
) -> list[str]:
    """Resolve section order for an existing generation.

    Legacy null values always resolve to template/historical default,
    NEVER to the user's current saved preference.
    """
    if generation_section_order:
        try:
            return validate_section_order(generation_section_order)
        except HTTPException:
            pass

    from src.template_registry.service import TemplateRegistryService
    manifest = TemplateRegistryService.get_template_manifest(template_id)
    if manifest and manifest.default_section_order:
        return list(manifest.default_section_order)
    return list(DEFAULT_SECTION_ORDER)


def save_user_template_layout(
    user: User,
    template_id: str,
    section_order: Sequence[str],
    supported_sections: Sequence[str] = SECTION_IDS,
) -> list[str]:
    """Validate and persist layout preference for a given template on User.

    Assigns a fresh dictionary to preferred_section_orders to guarantee
    SQLAlchemy change tracking detects the mutation.
    """
    validated = validate_section_order(section_order, supported_sections)
    existing = dict(user.preferred_section_orders) if user.preferred_section_orders else {}
    existing[template_id] = list(validated)
    user.preferred_section_orders = dict(existing)
    return validated


def load_sample_resume_fixture(sample_name: str = "dario-altman") -> dict[str, Any]:
    """Load fictional sample resume fixture for authentic template preview without LLM credits.

    Searches repo root and backend directory for sample-resume/{sample_name}.json.
    """
    candidate_paths = [
        settings.BACKEND_DIR.parent / "sample-resume" / f"{sample_name}.json",
        settings.BACKEND_DIR / "sample-resume" / f"{sample_name}.json",
        Path("sample-resume") / f"{sample_name}.json",
    ]
    for p in candidate_paths:
        if p.is_file():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception as e:
                raise RuntimeError(f"Failed to read sample resume fixture at {p}: {e}") from e

    raise FileNotFoundError(
        f"Sample resume fixture '{sample_name}.json' not found in candidate paths: "
        f"{[str(p) for p in candidate_paths]}"
    )


def render_template_preview_pages(
    *,
    template_id: str,
    manifest: TemplateManifest,
    section_order: Sequence[str] | None = None,
    scale: float = 1.25,
) -> tuple[list[str], Any, list[str]]:
    """Render authentic WeasyPrint PDF pages for a template preview.

    Uses fictional sample resume fixture (Dario Altman) and requested section order.
    Does NOT require a generation DB record or consume LLM credits.
    Returns (page_images, fit_result, effective_section_order).
    """
    from src.services.pdfium import render_page_images
    from src.services.resume_render import fit_and_render_pdf

    sample_data = load_sample_resume_fixture("dario-altman")
    profile = sample_data.get("profile", {})
    resume = sample_data.get("resume", {})

    effective_order = resolve_section_order(
        explicit_order=section_order,
        template_id=template_id,
        manifest=manifest,
    )

    pdf_bytes, fit_result = fit_and_render_pdf(
        template_id=template_id,
        profile=profile,
        resume=resume,
        manifest=manifest.model_dump(),
        section_order=effective_order,
    )

    page_images = render_page_images(pdf_bytes, scale=scale)

    return page_images, fit_result, effective_order
