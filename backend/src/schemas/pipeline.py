import ast

from pydantic import BaseModel, Field, field_validator


def _coerce_str_to_list(v):
    """Cerebras function-calling sometimes returns list values as string
    representations like ``"['Python', 'Go']"`` instead of actual arrays.
    Parse them back into real lists."""
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


class TailoredSummaryAndSkills(BaseModel):
    """Professional summary and categorized skills tailored to the target job."""
    summary: str = Field(description="Exactly 1-2 sentences, maximum 30 words, no first person, targeted to the job and supported by candidate evidence.")
    skills: dict[str, list[str]] = Field(
        default_factory=dict,
        description=(
            "3-6 skill categories as a dictionary of short skill-name lists. Must include 'Soft Skills'. "
            "Prioritize job-relevant skills and avoid keyword stuffing."
        ),
    )

    @field_validator("skills", mode="before")
    @classmethod
    def coerce_skill_values(cls, v):
        if isinstance(v, dict):
            return {k: _coerce_str_to_list(val) for k, val in v.items()}
        return v


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

    @field_validator("skills", mode="before")
    @classmethod
    def coerce_skill_values(cls, v):
        if isinstance(v, dict):
            return {k: _coerce_str_to_list(val) for k, val in v.items()}
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
