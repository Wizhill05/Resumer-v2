from __future__ import annotations

import uuid

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.user import User
from src.schemas.template import ContentSplit, TemplateManifest


def resolve_default_split(user: User | None, manifest: TemplateManifest) -> ContentSplit:
    """Return the manifest split entry that acts as this user's default.

    A stored per-user preference wins when it is a valid split for the
    requested template; otherwise the template default applies.
    """
    if (
        user is not None
        and user.preferred_projects is not None
        and user.preferred_experience is not None
    ):
        for split in manifest.allowed_content_splits:
            if (
                split.projects == user.preferred_projects
                and split.experience == user.preferred_experience
            ):
                return split
    return manifest.default_content_split


def split_is_allowed(projects: int, experience: int, manifest: TemplateManifest) -> bool:
    return (projects, experience) in {
        (s.projects, s.experience) for s in manifest.allowed_content_splits
    }


async def save_user_split_preference(
    db: AsyncSession,
    user_id: uuid.UUID,
    projects: int,
    experience: int,
) -> None:
    """Persist a user's chosen split as their new hidden default."""
    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values(preferred_projects=projects, preferred_experience=experience)
    )
