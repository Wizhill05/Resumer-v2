from typing import TypedDict, Optional


class ResumeGraphState(TypedDict):
    # Inputs
    user_id: str
    profile: dict
    projects: list[dict]
    experiences: list[dict]
    education: list[dict]
    extracurriculars: list[dict]
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
    orphans: Optional[list[dict]]

    # Render Output
    pdf_bytes: Optional[bytes]
    markdown: Optional[str]
    page_count: int
    font_size: float

    # Artifact storage keys (set by save_artifacts_node; None = upload skipped/failed)
    pdf_storage_key: Optional[str]
    md_storage_key: Optional[str]
    thumb_storage_key: Optional[str]

    # Controls & Logs
    repair_attempts: int
    render_attempts: int
    content_reduction_step: int
    errors: list[str]
    logs: list[str]
