import uuid
import contextvars
from datetime import datetime, timezone
from typing import Any
from jinja2 import Template

from langchain_core.prompts import ChatPromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import insert

from src.core.config import settings
from src.core.storage import StorageService
from src.models.generation import Generation, GenerationLog
from src.schemas.pipeline import (
    JobAnalysis,
    TailoredSummaryAndSkills,
    TailoredExperience,
    TailoredProject,
)
from src.template_registry.service import TemplateRegistryService
from src.pipeline.state import ResumeGraphState


# ── Log Helper ────────────────────────────────────────────────────────────────

# ContextVar to stream logs via SSE without altering node signatures
sse_queue_var = contextvars.ContextVar("sse_queue", default=None)


async def log_progress(db: AsyncSession, gen_id: str, node_name: str, message: str, level: str = "info"):
    print(f"[{node_name}] {message}")
    # Async insert log
    await db.execute(
        insert(GenerationLog).values(
            generation_id=uuid.UUID(gen_id),
            level=level,
            message=message,
            node_name=node_name,
            timestamp=datetime.now(timezone.utc),
        )
    )
    await db.commit()

    queue = sse_queue_var.get()
    if queue:
        await queue.put({"node": node_name, "message": message, "level": level})


# ── LLM Init Helper ───────────────────────────────────────────────────────────

def get_llm():
    return ChatGoogleGenerativeAI(
        model="gemini-2.5-flash",
        temperature=0.2,
    )


# ── Graph Nodes ───────────────────────────────────────────────────────────────

async def job_analysis_node(state: ResumeGraphState, db: AsyncSession, gen_id: str) -> dict[str, Any]:
    await log_progress(db, gen_id, "job_analysis", "Starting job description analysis...")

    llm = get_llm()
    structured_llm = llm.with_structured_output(JobAnalysis)

    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are an expert technical recruiter. Analyze the job description and extract key information."),
        ("user", "Job Description:\n{job_desc}\n\nKeywords/Focus:\n{keywords}\n\nInstructions:\n{instructions}")
    ])

    chain = prompt | structured_llm
    result = await chain.ainvoke({
        "job_desc": state["job_description"],
        "keywords": ", ".join(state["keywords"]) if state["keywords"] else "None",
        "instructions": state["instructions"] or "None"
    })

    await log_progress(db, gen_id, "job_analysis", f"Extracted Job Title: '{result.job_title}' at '{result.company}'")
    return {"job_analysis": result.model_dump()}


async def summary_skills_node(state: ResumeGraphState, db: AsyncSession, gen_id: str) -> dict[str, Any]:
    await log_progress(db, gen_id, "summary_skills", "Generating tailored summary & categorizing skills...")

    llm = get_llm()
    structured_llm = llm.with_structured_output(TailoredSummaryAndSkills)

    prompt = ChatPromptTemplate.from_messages([
        ("system", (
            "You are a professional resume writer. Write a tailored summary (3-4 sentences) and organize the candidate's skills "
            "into logical categories matching requirements from the job analysis."
        )),
        ("user", "Job Analysis:\n{job_analysis}\n\nCandidate Skills:\n{candidate_skills}\n\nCandidate Summary:\n{candidate_summary}")
    ])

    chain = prompt | structured_llm
    result = await chain.ainvoke({
        "job_analysis": str(state["job_analysis"]),
        "candidate_skills": ", ".join(state["profile"].get("skills") or []),
        "candidate_summary": state["profile"].get("summary") or ""
    })

    await log_progress(db, gen_id, "summary_skills", "Successfully tailored summary and grouped skills.")
    return {"summary_draft": result.model_dump()}


async def experience_node(state: ResumeGraphState, db: AsyncSession, gen_id: str) -> dict[str, Any]:
    await log_progress(db, gen_id, "experience_writer", "Tailoring experience bullet points...")

    experiences = state["experiences"]
    if not experiences:
        await log_progress(db, gen_id, "experience_writer", "No experiences to tailor.")
        return {"experience_draft": []}

    llm = get_llm()
    # Tailor each experience in sequence (can also be done in parallel or batch)
    tailored_exps = []
    for exp in experiences[:state["template_manifest"].get("max_experience", 3)]:
        await log_progress(db, gen_id, "experience_writer", f"Tailoring role: {exp['role']} at {exp['organization']}")

        prompt = ChatPromptTemplate.from_messages([
            ("system", (
                "You are an expert resume writer. Tailor this experience entry to target the job analysis. "
                "Rewrite the bullet points using action verbs and highlight metrics or accomplishments relevant to the requirements."
            )),
            ("user", "Job Analysis:\n{job_analysis}\n\nRole: {role}\nCompany: {org}\nBullet Points:\n{bullets}")
        ])

        structured_llm = llm.with_structured_output(TailoredExperience)
        chain = prompt | structured_llm
        result = await chain.ainvoke({
            "job_analysis": str(state["job_analysis"]),
            "role": exp["role"],
            "org": exp["organization"],
            "bullets": "\n".join(exp.get("bullet_points") or [])
        })

        # Keep original dates and locations
        tailored_exps.append({
            "role": result.role,
            "organization": result.organization,
            "location": exp.get("location") or result.location,
            "start_date": exp.get("start_date") or result.start_date,
            "end_date": exp.get("end_date") or result.end_date,
            "bullet_points": result.bullet_points,
        })

    await log_progress(db, gen_id, "experience_writer", "Finished tailoring all experience entries.")
    return {"experience_draft": tailored_exps}


async def project_node(state: ResumeGraphState, db: AsyncSession, gen_id: str) -> dict[str, Any]:
    await log_progress(db, gen_id, "projects_writer", "Selecting and tailoring projects...")

    projects = state["projects"]
    if not projects:
        await log_progress(db, gen_id, "projects_writer", "No projects to tailor.")
        return {"projects_draft": []}

    llm = get_llm()
    tailored_projs = []
    for proj in projects[:state["template_manifest"].get("max_projects", 3)]:
        await log_progress(db, gen_id, "projects_writer", f"Tailoring project: {proj['name']}")

        prompt = ChatPromptTemplate.from_messages([
            ("system", (
                "You are an expert resume writer. Tailor this project entry to target the job analysis. "
                "Highlight technologies and achievements relevant to the target role."
            )),
            ("user", "Job Analysis:\n{job_analysis}\n\nProject Name: {name}\nDescription: {desc}\nTechnologies: {techs}\nBullet Points:\n{bullets}")
        ])

        structured_llm = llm.with_structured_output(TailoredProject)
        chain = prompt | structured_llm
        result = await chain.ainvoke({
            "job_analysis": str(state["job_analysis"]),
            "name": proj["name"],
            "desc": proj.get("description") or "",
            "techs": ", ".join(proj.get("technologies") or []),
            "bullets": "\n".join(proj.get("bullet_points") or [])
        })

        tailored_projs.append({
            "name": result.name,
            "description": result.description,
            "technologies": result.technologies,
            "bullet_points": result.bullet_points,
            "start_date": proj.get("start_date"),
            "end_date": proj.get("end_date"),
        })

    await log_progress(db, gen_id, "projects_writer", "Finished tailoring all project entries.")
    return {"projects_draft": tailored_projs}


async def assembly_node(state: ResumeGraphState, db: AsyncSession, gen_id: str) -> dict[str, Any]:
    await log_progress(db, gen_id, "assembly", "Assembling tailored resume structure...")

    summary_draft = state["summary_draft"] or {}
    experiences = state["experience_draft"] or []
    projects = state["projects_draft"] or []

    # Map education directly
    education = []
    for edu in state["education"]:
        education.append({
            "institution": edu.get("institution"),
            "degree": edu.get("degree"),
            "location": edu.get("location"),
            "start_date": edu.get("start_date"),
            "end_date": edu.get("end_date"),
            "gpa": edu.get("gpa"),
            "coursework": edu.get("coursework") or [],
        })

    tailored_resume = {
        "summary": summary_draft.get("summary"),
        "skills": summary_draft.get("skills") or {},
        "experiences": experiences,
        "projects": projects,
        "education": education,
    }

    await log_progress(db, gen_id, "assembly", "Resume assembly complete.")
    return {"tailored_resume": tailored_resume}


async def render_node(state: ResumeGraphState, db: AsyncSession, gen_id: str) -> dict[str, Any]:
    await log_progress(db, gen_id, "renderer", "Rendering PDF via WeasyPrint & checking page-fit constraints...")

    try:
        from weasyprint import HTML
    except (OSError, ImportError) as e:
        await log_progress(db, gen_id, "renderer", f"WeasyPrint failed to load. Pango/Cairo system libraries likely missing: {e}", "error")
        raise RuntimeError("PDF rendering is not configured on this host (missing Pango/Cairo libraries).") from e

    template_manifest = state["template_manifest"]
    template_id = template_manifest["id"]
    html_template_str = TemplateRegistryService.get_template_html(template_id)

    if not html_template_str:
        raise ValueError(f"Template files for '{template_id}' not found.")

    jinja_template = Template(html_template_str)

    # Perform binary-search over font sizes to auto-fit target page limit
    low = template_manifest.get("min_font_size", 8.0)
    high = template_manifest.get("max_font_size", 12.0)
    target_pages = template_manifest.get("target_pages", 1)

    best_font_size = high
    best_pdf_bytes = None
    best_page_count = 999

    for attempt in range(5):
        mid = (low + high) / 2
        html_rendered = jinja_template.render(
            profile=state["profile"],
            resume=state["tailored_resume"],
            font_size=mid,
            page_margin_mm=template_manifest.get("page_margin_mm", 15),
        )

        doc = HTML(string=html_rendered).render()
        page_count = len(doc.pages)
        await log_progress(db, gen_id, "renderer", f"Render attempt {attempt + 1}: font_size={mid:.2f}pt -> page_count={page_count}")

        if page_count <= target_pages:
            # Fits! Save this and try a slightly larger font size to fill the page
            best_font_size = mid
            best_pdf_bytes = doc.write_pdf()
            best_page_count = page_count
            low = mid + 0.25
        else:
            # Overflow, must shrink font
            high = mid - 0.25

    if best_pdf_bytes is None:
        # Fallback to minimum font size if nothing fit within the limit
        await log_progress(db, gen_id, "renderer", "Warning: PDF overflowed at maximum constraints. Defaulting to minimum font size.", "warning")
        html_rendered = jinja_template.render(
            profile=state["profile"],
            resume=state["tailored_resume"],
            font_size=template_manifest.get("min_font_size", 8.0),
            page_margin_mm=template_manifest.get("page_margin_mm", 15),
        )
        doc = HTML(string=html_rendered).render()
        best_pdf_bytes = doc.write_pdf()
        best_page_count = len(doc.pages)
        best_font_size = template_manifest.get("min_font_size", 8.0)

    await log_progress(db, gen_id, "renderer", f"Render successful: font_size={best_font_size:.2f}pt, page_count={best_page_count}")

    # Generate Markdown version for history / parsing / raw text copies
    md_content = f"# {state['profile'].get('full_name')}\n\n"
    if state["tailored_resume"].get("summary"):
        md_content += f"## Professional Summary\n{state['tailored_resume']['summary']}\n\n"
    return {
        "pdf_bytes": best_pdf_bytes,
        "markdown": md_content,
        "page_count": best_page_count,
        "font_size": best_font_size,
    }


async def save_artifacts_node(state: ResumeGraphState, db: AsyncSession, gen_id: str) -> dict[str, Any]:
    await log_progress(db, gen_id, "saver", "Uploading artifact files to Cloudflare R2 storage...")

    pdf_bytes = state["pdf_bytes"]
    md_text = state["markdown"]

    pdf_key = f"runs/{gen_id}/resume.pdf"
    md_key = f"runs/{gen_id}/resume.md"

    storage = StorageService()
    pdf_uploaded = False
    md_uploaded = False

    if pdf_bytes:
        pdf_uploaded = storage.upload_bytes(pdf_bytes, pdf_key, "application/pdf")
    if md_text:
        md_uploaded = storage.upload_bytes(md_text.encode("utf-8"), md_key, "text/markdown")

    if pdf_uploaded:
        await log_progress(db, gen_id, "saver", f"Uploaded PDF artifact to: {pdf_key}")
    if md_uploaded:
        await log_progress(db, gen_id, "saver", f"Uploaded Markdown artifact to: {md_key}")

    # Update generation status in DB
    await db.execute(
        insert(GenerationLog).values(
            generation_id=uuid.UUID(gen_id),
            level="info",
            message="Generation pipeline successfully completed.",
            node_name="saver",
            timestamp=datetime.now(timezone.utc),
        )
    )

    # Note: caller will mark generation status as 'completed' and save keys
    return {}
