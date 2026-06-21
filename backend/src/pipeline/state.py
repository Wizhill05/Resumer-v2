from typing import TypedDict, Optional


class ResumeGraphState(TypedDict):
    # Inputs
    user_id: str
    profile: dict
    projects: list[dict]
    experiences: list[dict]
    education: list[dict]
    job_description: str
    keywords: list[str]
    instructions: str
    template_manifest: dict

    # Outputs
    job_analysis: Optional[dict]
    summary_draft: Optional[dict]
    projects_draft: Optional[dict]
    experience_draft: Optional[dict]
    tailored_resume: Optional[dict]

    # Render Output
    pdf_bytes: Optional[bytes]
    markdown: Optional[str]
    page_count: int
    font_size: float

    # Controls & Logs
    repair_attempts: int
    render_attempts: int
    errors: list[str]
    logs: list[str]
