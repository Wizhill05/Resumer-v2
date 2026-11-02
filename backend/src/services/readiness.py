"""Shared profile-readiness rules.

The HTTP readiness endpoint, the MCP readiness tool, and the generation
pipeline must all agree on what counts as a usable profile. Keeping the rules
here prevents the API and the agent-facing tools from drifting apart.

A profile is ready when it has:

* a candidate name (profile value, falling back to the account name),
* a contact email (profile value, falling back to the account email),
* at least one professional link,
* at least three distinct skills, and
* enough *usable* projects/experiences for at least one allowed content split.

Incomplete extra entries are reported as gaps but do not block generation when
enough usable entries remain. Entries that fail the usability rules are also
excluded from generation so the pipeline only selects usable material.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

from src.core.config import settings
from src.models.profile import Profile
from src.models.user import User
from src.schemas.template import ContentSplit, TemplateManifest
from src.services.content_split import resolve_default_split

def readiness_next_steps(is_ready: bool) -> str:
    if is_ready:
        return "Ask for a job description and use generate_resume to create a tailored resume."
    profile_url = f"{settings.FRONTEND_URL.rstrip('/')}/profile"
    return (
        "Explain the missing information. Offer to review old resumes the user shares and "
        "add their confirmed details using the profile tools, or direct them to "
        f"{profile_url} to import PDF resumes or enter details manually. "
        "Use only information provided by the user; do not invent facts. "
        "After the profile is updated, call check_readiness again before generating."
    )


MIN_DISTINCT_SKILLS = 3
BLOCKING_FIELDS = {"full_name", "email", "professional_link", "skills", "content_split"}


def has_text(value: Any) -> bool:
    """True when *value* is a non-blank string."""
    return isinstance(value, str) and bool(value.strip())


def has_items(values: Iterable[Any] | None) -> bool:
    """True when at least one item in *values* is a non-blank string."""
    return any(has_text(value) for value in (values or []))


def _field(item: Any, name: str) -> Any:
    """Read *name* from an ORM row or a plain dict."""
    if isinstance(item, dict):
        return item.get(name)
    return getattr(item, name, None)


def project_is_usable(project: Any) -> bool:
    """A project needs a name and either a description or a bullet point."""
    return has_text(_field(project, "name")) and (
        has_text(_field(project, "description")) or has_items(_field(project, "bullet_points"))
    )


def experience_is_usable(experience: Any) -> bool:
    """An experience needs a role, an organization, and at least one bullet."""
    return (
        has_text(_field(experience, "role"))
        and has_text(_field(experience, "organization"))
        and has_items(_field(experience, "bullet_points"))
    )


def usable_projects(projects: Iterable[Any]) -> list[Any]:
    return [project for project in projects if project_is_usable(project)]


def usable_experiences(experiences: Iterable[Any]) -> list[Any]:
    return [experience for experience in experiences if experience_is_usable(experience)]


def distinct_skills(profile: Profile | None) -> list[str]:
    """Return skills deduplicated by trimmed, case-insensitive value."""
    seen: dict[str, str] = {}
    for skill in (profile.skills or []) if profile else []:
        if has_text(skill):
            seen.setdefault(skill.strip().casefold(), skill.strip())
    return list(seen.values())


@dataclass(frozen=True)
class ReadinessGap:
    field: str
    message: str


@dataclass
class ProfileAssessment:
    """Identity, skills, and usable-entry assessment shared by every caller."""

    full_name: str | None
    email: str | None
    professional_link: str | None
    skills: list[str]
    total_projects: int
    total_experiences: int
    usable_project_count: int
    usable_experience_count: int
    gaps: list[ReadinessGap] = field(default_factory=list)

    @property
    def skills_count(self) -> int:
        return len(self.skills)

    @property
    def skills_needed(self) -> int:
        return max(0, MIN_DISTINCT_SKILLS - self.skills_count)

    @property
    def blocking_gaps(self) -> list[ReadinessGap]:
        return [gap for gap in self.gaps if gap.field in BLOCKING_FIELDS]

    @property
    def entry_gaps(self) -> list[ReadinessGap]:
        return [
            gap
            for gap in self.gaps
            if gap.field.startswith("projects.") or gap.field.startswith("experiences.")
        ]

    @property
    def is_profile_ready(self) -> bool:
        return not self.blocking_gaps


def assess_profile(
    user: User | None,
    profile: Profile | None,
    projects: Iterable[Any],
    experiences: Iterable[Any],
) -> ProfileAssessment:
    """Assess identity, skills, and entry usability using the shared rules."""
    projects = list(projects)
    experiences = list(experiences)
    usable_project_rows = usable_projects(projects)
    usable_experience_rows = usable_experiences(experiences)

    full_name = profile.full_name if profile and has_text(profile.full_name) else None
    if not full_name and user and has_text(user.name):
        full_name = user.name

    email = profile.email if profile and has_text(profile.email) else None
    if not email and user and has_text(user.email):
        email = user.email

    professional_link = None
    if profile:
        for link in (profile.github_url, profile.linkedin_url, profile.portfolio_url):
            if has_text(link):
                professional_link = link.strip()
                break

    skills = distinct_skills(profile)
    gaps: list[ReadinessGap] = []
    if not full_name:
        gaps.append(ReadinessGap(field="full_name", message="Add your full name."))
    if not email:
        gaps.append(ReadinessGap(field="email", message="Add a contact email."))
    if not professional_link:
        gaps.append(
            ReadinessGap(
                field="professional_link",
                message="Add a GitHub, LinkedIn, or portfolio link.",
            )
        )
    if len(skills) < MIN_DISTINCT_SKILLS:
        gaps.append(
            ReadinessGap(
                field="skills",
                message=f"Add {MIN_DISTINCT_SKILLS - len(skills)} more distinct skill(s) that you have.",
            )
        )

    for index, project in enumerate(projects):
        if project_is_usable(project):
            continue
        identifier = _field(project, "id") or index
        name = _field(project, "name") or "this project"
        gaps.append(
            ReadinessGap(
                field=f"projects.{identifier}",
                message=f"Add a name and description or bullet point for project '{name}'.",
            )
        )

    for index, experience in enumerate(experiences):
        if experience_is_usable(experience):
            continue
        identifier = _field(experience, "id") or index
        role = _field(experience, "role") or "this experience"
        gaps.append(
            ReadinessGap(
                field=f"experiences.{identifier}",
                message=f"Add a role, organization, and bullet point for experience '{role}'.",
            )
        )

    return ProfileAssessment(
        full_name=full_name,
        email=email,
        professional_link=professional_link,
        skills=skills,
        total_projects=len(projects),
        total_experiences=len(experiences),
        usable_project_count=len(usable_project_rows),
        usable_experience_count=len(usable_experience_rows),
        gaps=gaps,
    )


@dataclass(frozen=True)
class SplitAvailability:
    """One allowed split plus how many usable entries it still needs."""

    template_id: str
    projects: int
    experience: int
    label: str
    additional_projects: int
    additional_experiences: int

    @property
    def is_available(self) -> bool:
        return self.additional_projects == 0 and self.additional_experiences == 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "template_id": self.template_id,
            "projects": self.projects,
            "experience": self.experience,
            "label": self.label,
            "additional_projects": self.additional_projects,
            "additional_experiences": self.additional_experiences,
        }


def split_availability(
    template: TemplateManifest,
    usable_project_count: int,
    usable_experience_count: int,
) -> list[SplitAvailability]:
    """Describe every allowed split for *template* against usable entry counts."""
    return [
        SplitAvailability(
            template_id=template.id,
            projects=split.projects,
            experience=split.experience,
            label=split.label,
            additional_projects=max(0, split.projects - usable_project_count),
            additional_experiences=max(0, split.experience - usable_experience_count),
        )
        for split in template.allowed_content_splits
    ]


def find_split(
    availability: Iterable[SplitAvailability],
    projects: int,
    experience: int,
) -> SplitAvailability | None:
    for split in availability:
        if split.projects == projects and split.experience == experience:
            return split
    return None


def select_viable_split(
    availability: Iterable[SplitAvailability],
    preferred: ContentSplit | None,
) -> SplitAvailability | None:
    """Pick the preferred split when it fits, otherwise the closest viable one.

    Generation and readiness use this same function so an agent that omits
    ``content_split`` never gets an incompatible default while another allowed
    split is satisfiable.
    """
    availability = list(availability)
    preferred_availability = None
    if preferred is not None:
        preferred_availability = find_split(
            availability, preferred.projects, preferred.experience
        )
        if preferred_availability and preferred_availability.is_available:
            return preferred_availability

    viable = [split for split in availability if split.is_available]
    if not viable:
        return None

    if preferred_availability is not None:
        return min(
            viable,
            key=lambda split: (
                abs(split.projects - preferred_availability.projects)
                + abs(split.experience - preferred_availability.experience),
                -split.projects,
                -split.experience,
            ),
        )

    return max(viable, key=lambda split: (split.projects + split.experience, split.projects))


def preferred_split_for(user: User | None, template: TemplateManifest) -> ContentSplit:
    """The stored/template default split, regardless of whether it fits."""
    return resolve_default_split(user, template)
