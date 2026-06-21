from pydantic import BaseModel


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

    max_projects: int = 3
    max_experience: int = 2
    max_skills_categories: int = 5
    max_bullets_per_project: int = 3
    max_bullets_per_experience: int = 3

    target_pages: int = 1
    min_font_size: float = 8.0
    max_font_size: float = 12.0
    page_margin_mm: int = 15
