"""Seed five resumable profiles in an explicitly configured local test database."""

import asyncio
import sys
from datetime import date
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

FIXTURES = (
    ("thin", "Alex River", 2, 2),
    ("rich", "Jordan Reed", 5, 5),
    ("student", "Sam Park", 1, 4),
    ("senior", "Taylor Evans", 4, 3),
    ("professional-sans", "Casey Lane", 2, 2),
)
SKILLS = ["Python", "FastAPI", "PostgreSQL", "SQL", "Docker", "Git", "pytest", "Redis", "Linux", "REST APIs"]


def require_local_database(database_url: str) -> None:
    try:
        url = make_url(database_url)
    except (ArgumentError, ValueError):
        raise SystemExit("Configure DATABASE_URL with a local PostgreSQL connection.") from None
    # PostgreSQL query parameters can override the URL host and use a service file.
    if url.host not in {"localhost", "127.0.0.1"} or {"host", "hostaddr", "service"} & url.query.keys():
        raise SystemExit("Refusing to use a DATABASE_URL outside localhost or 127.0.0.1.")


async def seed() -> None:
    from src.core.config import settings

    require_local_database(settings.DATABASE_URL)
    from src.core.database import AsyncSessionLocal
    from src.models.profile import Profile, UserEducation, UserExperience, UserExtracurricular, UserProject
    from src.models.user import User

    async with AsyncSessionLocal() as db:
        for label, name, experience_count, project_count in FIXTURES:
            email = f"own-model-{label}@example.test"
            existing = await db.scalar(select(User.id).where(User.email == email))
            if existing is not None:
                print(f"Existing {email}")
                continue
            user = User(
                email=email, name=name, provider="local-fixture",
                preferred_experience=min(experience_count, 2), preferred_projects=3 if label == "student" else 2,
            )
            db.add(user)
            await db.flush()
            db.add(Profile(
                user_id=user.id, full_name=name, email=email, location="Toronto, ON",
                summary="Software developer building reliable APIs, data services, and internal tools.",
                subtitle="Backend and Data Engineering" if label == "professional-sans" else None,
                github_url=f"https://github.com/resumer-fixture-{label}",
                skills=SKILLS, notify_on_completion=False,
            ))
            for index in range(experience_count):
                bullets = [
                    "Built FastAPI endpoints backed by PostgreSQL and added pytest coverage for data imports.",
                    "Reduced report processing time by 25% after profiling SQL queries and adding indexes.",
                ]
                if label == "senior":
                    bullets.append(
                        "Led the migration of a scheduled reporting service to independent Docker workers, "
                        "added replayable jobs and PostgreSQL audit records, and documented the rollout for support engineers."
                    )
                db.add(UserExperience(
                    user_id=user.id, role="Backend Engineer" if label != "senior" else "Senior Backend Engineer",
                    organization=f"Test Organization {index + 1}", start_date=date(2024 - index, 1, 1),
                    bullet_points=bullets, sort_order=index,
                ))
            for index in range(project_count):
                db.add(UserProject(
                    user_id=user.id, name=f"Data Tools {index + 1}",
                    description="A service for validating, indexing, and exploring test records.",
                    technologies=["Python", "FastAPI", "PostgreSQL"],
                    bullet_points=[
                        "Designed a PostgreSQL data model with indexed filters for searching archived records.",
                        "Packaged the FastAPI service with Docker and added integration tests using pytest.",
                    ],
                    sort_order=index,
                ))
            db.add(UserEducation(user_id=user.id, degree="B.Sc. in Computing", institution="Test University"))
            if label != "thin":
                db.add(UserExtracurricular(
                    user_id=user.id, title="Programming club", organization="Test University",
                    description="Ran weekly workshops on Git, Python, and testing for new contributors.",
                ))
            print(f"Created {email}")
        await db.commit()


if __name__ == "__main__":
    asyncio.run(seed())
