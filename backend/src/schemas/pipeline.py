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
    job_title: str = Field(description="The target job title or role name")
    company: str = Field(default="Unknown Company", description="The company name if found")
    seniority: str = Field(description="Estimated seniority level (e.g. Junior, Mid-Level, Senior, Lead)")
    key_requirements: list[str] = Field(default_factory=list, description="Top 5-10 key requirements or responsibilities")
    extracted_skills: list[str] = Field(default_factory=list, description="Essential technical and soft skills mentioned in the job description")


class TailoredSummaryAndSkills(BaseModel):
    """Professional summary and categorized skills tailored to the target job."""
    summary: str = Field(description="A professional summary of exactly 1-2 sentences (maximum 2 lines / 30 words) tailored to the target job.")
    skills: dict[str, list[str]] = Field(
        default_factory=dict,
        description=(
            "Categorized skills relevant to the job description. Must include a 'Soft Skills' category. "
            "Example: {'Languages': ['Python', 'Go'], 'Frontend': ['React', 'TypeScript'], "
            "'Soft Skills': ['Leadership', 'Communication', 'Problem-Solving']}. Max 5-6 categories."
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
    name: str = Field(description="Project name")
    project_summary: str | None = Field(default=None, description="A 2-4 word high-level description of what the project is, e.g., 'API to MCP converter'")
    description: str | None = Field(default=None, description="Short project description")
    technologies: list[str] = Field(default_factory=list, description="Technologies used in the project")
    bullet_points: list[str] = Field(
        default_factory=list,
        description="2-3 achievement-focused bullet points tailored to the job description using Action Verbs."
    )


class TailoredExperience(BaseModel):
    """A professional experience entry tailored to highlight relevance to the target job."""
    role: str = Field(description="Role or job title")
    organization: str = Field(description="Company or organization name")
    location: str | None = Field(default=None, description="Job location")
    start_date: str | None = Field(default=None, description="Start date string (e.g. YYYY-MM-DD or Month YYYY)")
    end_date: str | None = Field(default=None, description="End date string (e.g. YYYY-MM-DD, Month YYYY, or 'Present')")
    bullet_points: list[str] = Field(
        default_factory=list,
        description="2-4 tailored bullet points highlighting key achievements and skills relevant to the target job."
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
        description="All tailored experience entries in the same order as the input."
    )


class TailoredProjectBatch(BaseModel):
    """Batch of tailored project entries."""
    entries: list[TailoredProject] = Field(
        default_factory=list,
        description="All tailored project entries in the same order as the input."
    )


class TailoredExtracurricular(BaseModel):
    """A single extracurricular activity/achievement rewritten as a descriptive sentence."""
    description: str = Field(
        description=(
            "A single compelling sentence describing the achievement or activity. "
            "Example: 'Led the winning team of Hacknight 2024 held at SCEM Mangalore'"
        )
    )


class TailoredExtracurricularBatch(BaseModel):
    """Batch of tailored extracurricular entries."""
    entries: list[TailoredExtracurricular] = Field(
        default_factory=list,
        description="All tailored extracurricular entries in the same order as the input.",
    )


class SelectedItems(BaseModel):
    """Indices of selected projects and experiences based on job relevance."""
    selected_experience_indices: list[int] = Field(
        default_factory=list,
        description="0-based indices of experiences selected as most relevant, ordered by relevance."
    )
    selected_project_indices: list[int] = Field(
        default_factory=list,
        description="0-based indices of projects selected as most relevant, ordered by relevance."
    )
