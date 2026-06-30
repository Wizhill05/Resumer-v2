from pydantic import BaseModel


class ContentSplit(BaseModel):
    """One valid project/experience distribution for a template's content slots."""
    projects: int
    experience: int
    label: str


class TemplateManifest(BaseModel):
    id: str
    name: str
    description: str
    preview_image: str

    has_photo: bool = False
    has_summary: bool = True
    has_objective: bool = False
    has_links: bool = True
    has_education: bool = True
    has_extracurricular: bool = False

    # ── Content slot system ────────────────────────────────────────────────────
    # Total number of project + experience slots available in this template.
    content_slots: int = 4
    # Each element is one allowed distribution that the user may choose.
    # Backend enforces exactly the chosen split; AI is not trusted to self-limit.
    allowed_content_splits: list[ContentSplit] = [
        ContentSplit(projects=1, experience=3, label="Experience focused"),
        ContentSplit(projects=2, experience=2, label="Balanced"),
        ContentSplit(projects=3, experience=1, label="Project focused"),
    ]
    # Which split is pre-selected for the user (must exist in allowed_content_splits).
    default_content_split: ContentSplit = ContentSplit(projects=2, experience=2, label="Balanced")

    # Kept for bullet-level limits (independent of slot count).
    max_skills_categories: int = 5
    max_bullets_per_project: int = 3
    max_bullets_per_experience: int = 3

    target_pages: int = 1
    min_font_size: float = 8.0
    max_font_size: float = 12.0
    page_margin_mm: int = 15
