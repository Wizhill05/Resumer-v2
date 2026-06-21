from pydantic import BaseModel, Field


class JobAnalysis(BaseModel):
    """Result of analyzing the job description to extract target role details."""
    job_title: str = Field(description="The target job title or role name")
    company: str = Field(default="Unknown Company", description="The company name if found")
    seniority: str = Field(description="Estimated seniority level (e.g. Junior, Mid-Level, Senior, Lead)")
    key_requirements: list[str] = Field(default_factory=list, description="Top 5-10 key requirements or responsibilities")
    extracted_skills: list[str] = Field(default_factory=list, description="Essential technical and soft skills mentioned in the job description")


class TailoredSummaryAndSkills(BaseModel):
    """Professional summary and categorized skills tailored to the target job."""
    summary: str = Field(description="A professional summary of 3-4 sentences tailored to the target job.")
    skills: dict[str, list[str]] = Field(
        default_factory=dict,
        description="Categorized skills relevant to the job description (e.g., {'Languages': ['Python', 'Go'], 'Frontend': ['React']}). Max 5-6 categories."
    )


class TailoredProject(BaseModel):
    """A personal project tailored to highlight relevance to the target job."""
    name: str = Field(description="Project name")
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
