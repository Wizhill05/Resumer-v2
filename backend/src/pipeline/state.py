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
    # Resolved content split: {"projects": N, "experience": M}
    # Enforced by backend before AI runs; drives exact limits in every pipeline node.
    content_split: dict
    # Resolved section order snapshot for template body layout
    section_order: Optional[list[str]]
    is_pro: Optional[bool]
    # Truthfulness control: "proper" | "larp" | "super_larp". Defaults to proper.
    creativity_mode: str
    # Everything the candidate material says they can do (profile skills, every project's technologies, experience text).
    # Captured before selection narrows projects/experiences so the skills section can draw on all of it.
    candidate_evidence: Optional[dict]

    # Outputs
    job_analysis: Optional[dict]
    summary_draft: Optional[dict]
    projects_draft: Optional[dict]
    experience_draft: Optional[dict]
    extracurriculars_draft: Optional[list[dict]]
    tailored_resume: Optional[dict]
    orphans: Optional[list[dict]]

    # Render Output
    pdf_bytes: Optional[bytes]
    markdown: Optional[str]
    page_count: int
    font_size: float
    fits_target: Optional[bool]
    has_horizontal_overflow: Optional[bool]

    # Fallback status flags
    experience_fallback: Optional[bool]
    projects_fallback: Optional[bool]

    # Artifact storage keys (set by save_artifacts_node; None = upload skipped/failed)
    pdf_storage_key: Optional[str]
    md_storage_key: Optional[str]
    thumb_storage_key: Optional[str]

    # Controls & Logs
    repair_attempts: int
    repair_history: Optional[dict]  # maps "section:item_idx:bullet_idx" -> original text before repair
    render_attempts: int
    content_reduction_step: int
    errors: list[str]
    logs: list[str]
