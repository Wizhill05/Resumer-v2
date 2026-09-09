import ast

from typing import Any
from pydantic import BaseModel, Field, field_validator, model_validator

from src.core.skill_categories import (
    merge_skill_categories,
    merge_skill_items,
    skill_category_display as _display_skill_category,
    skill_category_key as _canonical_skill_key,
)


def _coerce_str_to_list(v):
    """Coerce string representations or comma-separated lists into actual lists."""
    if isinstance(v, str):
        v = v.strip()
        if v.startswith("["):
            try:
                parsed = ast.literal_eval(v)
                if isinstance(parsed, list):
                    return [str(i) for i in parsed]
            except (ValueError, SyntaxError):
                pass
        # Fallback: comma-separated string
        return [s.strip() for s in v.split(",") if s.strip()]
    return v


class JobAnalysis(BaseModel):
    """Result of analyzing the job description to extract target role details."""
    job_title: str = Field(description="Target job title or closest role name extracted from the job description.")
    company: str = Field(default="Unknown Company", description="Company name if present; otherwise exactly 'Unknown Company'.")
    seniority: str = Field(description="Conservative seniority estimate, e.g. Intern, Junior, Mid-Level, Senior, Lead, Manager.")
    key_requirements: list[str] = Field(default_factory=list, description="5-10 concise requirements/responsibilities ordered by hiring importance.")
    extracted_skills: list[str] = Field(default_factory=list, description="Normalized technical tools, domains, methods, and important soft skills from the role.")

class SkillCategory(BaseModel):
    category: str = Field(description="Category name, e.g. Languages, Frontend, Backend, Tools, Soft Skills.")
    skills: list[str] = Field(default_factory=list, description="List of short skill names in this category.")


class TailoredSummaryAndSkills(BaseModel):
    """Professional summary and categorized skills tailored to the target job."""
    summary: str = Field(description="Exactly 1-2 sentences, maximum 30 words, no first person, targeted to the job and supported by candidate evidence.")
    categories: list[SkillCategory] = Field(
        default_factory=list,
        description="3-6 categorized skill groups, including Soft Skills.",
    )
    skills: dict[str, list[str]] = Field(
        default_factory=dict,
        description="Dictionary mapping category name to list of skills.",
    )

    @model_validator(mode="before")
    @classmethod
    def normalize_summary_and_skills(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        # `categories` is the single source of truth. The model also fills the
        # legacy `skills` dict with the same categories under drifted names
        # ("Programming & Backend" vs "Programming Backend") — merging both is
        # what duplicated skill sections, so `skills` is only used as a
        # fallback when the model emitted no categories at all.
        categories = data.get("categories")
        if isinstance(categories, list) and categories:
            source: list[tuple[Any, Any]] = []
            for cat in categories:
                if isinstance(cat, dict):
                    source.append((cat.get("category") or "General", cat.get("skills") or cat.get("items") or []))
                elif hasattr(cat, "category") and hasattr(cat, "skills"):
                    source.append((cat.category, list(cat.skills)))
        else:
            source = []
            raw_skills = data.get("skills")
            if isinstance(raw_skills, dict):
                source = list(raw_skills.items())
            elif isinstance(raw_skills, list):
                for item in raw_skills:
                    if isinstance(item, dict):
                        source.append((item.get("category") or "General", item.get("skills") or item.get("items") or []))
                    elif isinstance(item, str) and ":" in item:
                        parts = item.split(":", 1)
                        source.append((parts[0].strip(), parts[1]))

        coerced: list[tuple[Any, Any]] = []
        for name, items in source:
            clean_items = _coerce_str_to_list(items)
            if isinstance(clean_items, str):
                clean_items = [clean_items]
            coerced.append((name, clean_items))

        data["skills"] = merge_skill_categories(coerced)
        return data

class TailoredProject(BaseModel):
    """A personal project tailored to highlight relevance to the target job."""
    name: str = Field(description="Project name, preserved from input except minor cleanup.")
    project_summary: str | None = Field(default=None, description="2-4 word project category, e.g. 'API Automation Platform'.")
    description: str | None = Field(default=None, description="One concise sentence explaining what the project does and why it matters.")
    technologies: list[str] = Field(default_factory=list, description="Normalized, supported technologies used in the project.")
    bullet_points: list[str] = Field(
        default_factory=list,
        description="2-3 job-tailored achievement bullets using action verbs, supported claims only, with numbers/metrics/key technologies bolded in markdown."
    )


class TailoredExperience(BaseModel):
    """A professional experience entry tailored to highlight relevance to the target job."""
    role: str = Field(description="Role or job title, preserved from input unless missing.")
    organization: str = Field(description="Company or organization name, preserved from input unless missing.")
    location: str | None = Field(default=None, description="Job location from input, if available.")
    start_date: str | None = Field(default=None, description="Start date from input, e.g. YYYY-MM-DD or Month YYYY.")
    end_date: str | None = Field(default=None, description="End date from input, e.g. YYYY-MM-DD, Month YYYY, or Present.")
    bullet_points: list[str] = Field(
        default_factory=list,
        description="2-4 job-tailored achievement bullets using action verbs, supported claims only, with numbers/metrics/key technologies bolded in markdown."
    )


class TailoredResume(BaseModel):
    """The complete tailored resume structure ready for HTML template rendering."""
    summary: str | None = None
    skills: dict[str, list[str]] = Field(default_factory=dict)
    experiences: list[TailoredExperience] = Field(default_factory=list)
    projects: list[TailoredProject] = Field(default_factory=list)
    education: list[dict] = Field(default_factory=list)
    extracurriculars: list[dict] = Field(default_factory=list)

    @field_validator("skills", mode="before")
    @classmethod
    def coerce_skill_values(cls, v):
        if isinstance(v, dict):
            coerced: dict[Any, Any] = {}
            for k, val in v.items():
                items = _coerce_str_to_list(val)
                if isinstance(items, str):
                    items = [items]
                coerced[k] = items
            return merge_skill_categories(coerced)
        return v


class TailoredExperienceBatch(BaseModel):
    """Batch of tailored experience entries."""
    entries: list[TailoredExperience] = Field(
        default_factory=list,
        description="All tailored experience entries, exactly matching input count and order."
    )


class TailoredProjectBatch(BaseModel):
    """Batch of tailored project entries."""
    entries: list[TailoredProject] = Field(
        default_factory=list,
        description="All tailored project entries, exactly matching input count and order."
    )


class TailoredExtracurricular(BaseModel):
    """A single extracurricular activity/achievement rewritten as a descriptive sentence."""
    description: str = Field(
        description=(
            "Exactly one concise resume sentence describing the activity or achievement, without inventing facts."
        )
    )


class TailoredExtracurricularBatch(BaseModel):
    """Batch of tailored extracurricular entries."""
    entries: list[TailoredExtracurricular] = Field(
        default_factory=list,
        description="All tailored extracurricular entries, exactly matching input count and order.",
    )


class SelectedItems(BaseModel):
    """Indices of selected projects and experiences based on job relevance."""
    selected_experience_indices: list[int] = Field(
        default_factory=list,
        description="0-based valid experience indices selected as most relevant, ordered strongest first, no duplicates."
    )
    selected_project_indices: list[int] = Field(
        default_factory=list,
        description="0-based valid project indices selected as most relevant, ordered strongest first, no duplicates."
    )
