import contextvars
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from jinja2 import Template
from langchain_core.prompts import ChatPromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI
from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import AsyncSessionLocal
from src.core.storage import StorageService
from src.models.generation import Generation, GenerationLog
from src.pipeline.state import ResumeGraphState
from src.schemas.pipeline import (
    JobAnalysis,
    TailoredExperience,
    TailoredProject,
    TailoredSummaryAndSkills,
)
from src.template_registry.service import TemplateRegistryService

# ── Log Helper ────────────────────────────────────────────────────────────────

# ContextVar to stream logs via SSE without altering node signatures
sse_queue_var = contextvars.ContextVar("sse_queue", default=None)


async def log_progress(
    db: AsyncSession, gen_id: str, node_name: str, message: str, level: str = "info"
):
    print(f"[{node_name}] {message}")
    # Use a fresh session per log insert to avoid concurrent commit conflicts
    async with AsyncSessionLocal() as log_session:
        await log_session.execute(
            insert(GenerationLog).values(
                generation_id=uuid.UUID(gen_id),
                level=level,
                message=message,
                node_name=node_name,
                timestamp=datetime.now(timezone.utc),
            )
        )
        await log_session.commit()

    queue = sse_queue_var.get()
    if queue:
        await queue.put({"node": node_name, "message": message, "level": level})


# ── LLM Init Helper ───────────────────────────────────────────────────────────


def get_llm():
    return ChatGoogleGenerativeAI(
        model="gemma-4-31b-it",
        temperature=0.2,
        google_api_key=settings.GOOGLE_API_KEY,
    )


# ── Graph Nodes ───────────────────────────────────────────────────────────────


async def job_analysis_node(
    state: ResumeGraphState, db: AsyncSession, gen_id: str
) -> dict[str, Any]:
    await log_progress(
        db, gen_id, "job_analysis", "Starting job description analysis..."
    )

    llm = get_llm()
    structured_llm = llm.with_structured_output(JobAnalysis)

    prompt = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                "You are an expert technical recruiter. Analyze the job description and extract key information.",
            ),
            (
                "user",
                "Job Description:\n{job_desc}\n\nKeywords/Focus:\n{keywords}\n\nInstructions:\n{instructions}",
            ),
        ]
    )

    chain = prompt | structured_llm
    result = await chain.ainvoke(
        {
            "job_desc": state["job_description"],
            "keywords": ", ".join(state["keywords"]) if state["keywords"] else "None",
            "instructions": state["instructions"] or "None",
        }
    )

    await log_progress(
        db,
        gen_id,
        "job_analysis",
        f"Extracted Job Title: '{result.job_title}' at '{result.company}'",
    )
    return {"job_analysis": result.model_dump()}


async def summary_skills_node(
    state: ResumeGraphState, db: AsyncSession, gen_id: str
) -> dict[str, Any]:
    await log_progress(
        db,
        gen_id,
        "summary_skills",
        "Generating tailored summary & categorizing skills...",
    )

    llm = get_llm()
    structured_llm = llm.with_structured_output(TailoredSummaryAndSkills)

    prompt = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                (
                    "You are a professional resume writer. Write a tailored professional summary of exactly 1-2 sentences "
                    "(maximum 2 lines / 30 words) that is highly concise and highlights the most important qualifications. "
                    "Then organize the candidate's skills into logical categories matching requirements from the job analysis."
                ),
            ),
            (
                "user",
                "Job Analysis:\n{job_analysis}\n\nCandidate Skills:\n{candidate_skills}\n\nCandidate Summary:\n{candidate_summary}",
            ),
        ]
    )

    chain = prompt | structured_llm
    result = await chain.ainvoke(
        {
            "job_analysis": str(state["job_analysis"]),
            "candidate_skills": ", ".join(state["profile"].get("skills") or []),
            "candidate_summary": state["profile"].get("summary") or "",
        }
    )

    await log_progress(
        db,
        gen_id,
        "summary_skills",
        "Successfully tailored summary and grouped skills.",
    )
    return {"summary_draft": result.model_dump()}


async def experience_node(
    state: ResumeGraphState, db: AsyncSession, gen_id: str
) -> dict[str, Any]:
    await log_progress(
        db, gen_id, "experience_writer", "Tailoring experience bullet points..."
    )

    experiences = state["experiences"]
    if not experiences:
        await log_progress(db, gen_id, "experience_writer", "No experiences to tailor.")
        return {"experience_draft": []}

    llm = get_llm()
    # Tailor each experience in sequence (can also be done in parallel or batch)
    tailored_exps = []
    for exp in experiences[: state["template_manifest"].get("max_experience", 3)]:
        await log_progress(
            db,
            gen_id,
            "experience_writer",
            f"Tailoring role: {exp['role']} at {exp['organization']}",
        )

        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    (
                        "You are an expert resume writer. Tailor this experience entry to target the job analysis. "
                        "Rewrite the bullet points using action verbs and highlight metrics or accomplishments relevant to the requirements. "
                        "Crucial line-fit rule: Each bullet point must be written such that it fits either strictly on 1 line, or if it wraps to a 2nd line, it must fill at least 75% of that 2nd line (i.e., between 1.75 and 1.95 lines long). NEVER write a bullet point that ends as an orphan (e.g. 1.1 to 1.7 lines long, where only a few words spill over to the second line). "
                        "Every single number, statistic, percentage, and key metric (e.g. **35%**, **FastAPI**, **400ms**) MUST be bolded using markdown asterisks."
                    ),
                ),
                (
                    "user",
                    "Job Analysis:\n{job_analysis}\n\nRole: {role}\nCompany: {org}\nBullet Points:\n{bullets}",
                ),
            ]
        )

        structured_llm = llm.with_structured_output(TailoredExperience)
        chain = prompt | structured_llm
        result = await chain.ainvoke(
            {
                "job_analysis": str(state["job_analysis"]),
                "role": exp["role"],
                "org": exp["organization"],
                "bullets": "\n".join(exp.get("bullet_points") or []),
            }
        )

        # Keep original dates and locations
        tailored_exps.append(
            {
                "role": result.role,
                "organization": result.organization,
                "location": exp.get("location") or result.location,
                "start_date": exp.get("start_date") or result.start_date,
                "end_date": exp.get("end_date") or result.end_date,
                "bullet_points": result.bullet_points,
            }
        )

    await log_progress(
        db, gen_id, "experience_writer", "Finished tailoring all experience entries."
    )
    return {"experience_draft": tailored_exps}


async def project_node(
    state: ResumeGraphState, db: AsyncSession, gen_id: str
) -> dict[str, Any]:
    await log_progress(
        db, gen_id, "projects_writer", "Selecting and tailoring projects..."
    )

    projects = state["projects"]
    if not projects:
        await log_progress(db, gen_id, "projects_writer", "No projects to tailor.")
        return {"projects_draft": []}

    llm = get_llm()
    tailored_projs = []
    for proj in projects[: state["template_manifest"].get("max_projects", 3)]:
        await log_progress(
            db, gen_id, "projects_writer", f"Tailoring project: {proj['name']}"
        )

        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    (
                        "You are an expert resume writer. Tailor this project entry to target the job analysis. "
                        "Highlight technologies and achievements relevant to the target role. "
                        "Crucial line-fit rule: Each bullet point must be written such that it fits either strictly on 1 line, or if it wraps to a 2nd line, it must fill at least 75% of that 2nd line (i.e., between 1.75 and 1.95 lines long). NEVER write a bullet point that ends as an orphan (e.g. 1.1 to 1.7 lines long, where only a few words spill over to the second line). "
                        "Every single number, statistic, percentage, and key metric (e.g. **35%**, **FastAPI**, **400ms**) MUST be bolded using markdown asterisks."
                    ),
                ),
                (
                    "user",
                    "Job Analysis:\n{job_analysis}\n\nProject Name: {name}\nDescription: {desc}\nTechnologies: {techs}\nBullet Points:\n{bullets}",
                ),
            ]
        )

        structured_llm = llm.with_structured_output(TailoredProject)
        chain = prompt | structured_llm
        result = await chain.ainvoke(
            {
                "job_analysis": str(state["job_analysis"]),
                "name": proj["name"],
                "desc": proj.get("description") or "",
                "techs": ", ".join(proj.get("technologies") or []),
                "bullets": "\n".join(proj.get("bullet_points") or []),
            }
        )

        tailored_projs.append(
            {
                "name": result.name,
                "project_summary": result.project_summary,
                "description": result.description,
                "technologies": result.technologies,
                "bullet_points": result.bullet_points,
                "github_url": proj.get("github_url"),
                "live_url": proj.get("live_url"),
                "start_date": proj.get("start_date"),
                "end_date": proj.get("end_date"),
            }
        )

    await log_progress(
        db, gen_id, "projects_writer", "Finished tailoring all project entries."
    )
    return {"projects_draft": tailored_projs}


async def assembly_node(
    state: ResumeGraphState, db: AsyncSession, gen_id: str
) -> dict[str, Any]:
    await log_progress(
        db, gen_id, "assembly", "Assembling tailored resume structure..."
    )

    summary_draft = state["summary_draft"] or {}
    experiences = state["experience_draft"] or []
    projects = state["projects_draft"] or []

    # Map education directly
    education = []
    for edu in state["education"]:
        education.append(
            {
                "institution": edu.get("institution"),
                "degree": edu.get("degree"),
                "location": edu.get("location"),
                "start_date": edu.get("start_date"),
                "end_date": edu.get("end_date"),
                "gpa": edu.get("gpa"),
                "coursework": edu.get("coursework") or [],
            }
        )

    # Map extracurriculars directly
    extracurriculars = []
    for ex in state.get("extracurriculars") or []:
        extracurriculars.append(
            {
                "title": ex.get("title"),
                "organization": ex.get("organization"),
                "description": ex.get("description"),
                "start_date": ex.get("start_date"),
                "end_date": ex.get("end_date"),
                "bullet_points": ex.get("bullet_points") or [],
            }
        )

    tailored_resume = {
        "summary": summary_draft.get("summary"),
        "skills": summary_draft.get("skills") or {},
        "experiences": experiences,
        "projects": projects,
        "education": education,
        "extracurriculars": extracurriculars,
    }

    await log_progress(db, gen_id, "assembly", "Resume assembly complete.")
    return {"tailored_resume": tailored_resume}


def detect_orphans_in_weasyprint(doc) -> list[dict[str, Any]]:
    """Walks the WeasyPrint document layout tree and finds orphan/oversize bullets."""
    orphan_data = []

    def get_text(box):
        if hasattr(box, "text") and box.text:
            return box.text
        texts = []
        for child in getattr(box, "children", []):
            texts.append(get_text(child))
        return "".join(texts)

    try:
        if not doc or not doc.pages:
            return []

        for page in doc.pages:
            li_lines = {}
            current_section = ["unknown"]

            def walk_tree(box, current_li_element=None, current_li_box=None):
                if type(box).__name__ == "MarkerBox" or getattr(box, "pseudo_type", None) == "marker":
                    return

                tag = getattr(box, "element_tag", None)
                dom_element = getattr(box, "element", None)

                if dom_element is not None and tag == "h2":
                    h2_text = "".join(dom_element.itertext()).strip().lower()
                    if "project" in h2_text:
                        current_section[0] = "projects"
                    elif "experience" in h2_text:
                        current_section[0] = "experience"
                    elif "activit" in h2_text or "achievement" in h2_text:
                        current_section[0] = "activities"

                next_li_element = current_li_element
                next_li_box = current_li_box

                if dom_element is not None and tag == "li":
                    next_li_element = dom_element
                    next_li_box = box

                if type(box).__name__ == "LineBox":
                    if current_li_element is not None and tag != "li::marker":
                        if current_li_element not in li_lines:
                            li_lines[current_li_element] = {"lines": [], "section": current_section[0]}
                        li_lines[current_li_element]["lines"].append((box, current_li_box))

                for child in getattr(box, "children", []):
                    walk_tree(child, next_li_element, next_li_box)

            walk_tree(page._page_box)

            for el, data in li_lines.items():
                lines = data["lines"]
                section = data["section"]
                text = "".join(el.itertext()).strip()
                if not text:
                    continue

                line_count = len(lines)
                if line_count <= 1:
                    continue

                widths = [line.width for line, _ in lines]
                first_line_width = widths[0]
                full_width = max(widths[:-1]) if len(widths) > 1 else first_line_width

                if full_width <= 0:
                    continue

                last_line_width = widths[-1]
                last_line_fill = last_line_width / full_width

                avg_char_width = 5.2
                chars_per_line = int(full_width / avg_char_width) if full_width > 0 else 90

                if line_count == 2 and last_line_fill < 0.75:
                    target_min = int(chars_per_line * 1.80)
                    target_max = int(chars_per_line * 1.95)
                    orphan_data.append({
                        "fix_type": "expand",
                        "section": section,
                        "text": text,
                        "currentChars": len(text),
                        "renderedLines": line_count,
                        "charsPerLine": chars_per_line,
                        "targetCharsMin": target_min,
                        "targetCharsMax": target_max,
                        "charsToAddMin": max(0, target_min - len(text)),
                        "charsToAddMax": max(0, target_max - len(text)),
                    })
                elif line_count > 2:
                    target_max = int(chars_per_line * 1.95)
                    orphan_data.append({
                        "fix_type": "shorten",
                        "section": section,
                        "text": text,
                        "currentChars": len(text),
                        "renderedLines": line_count,
                        "charsPerLine": chars_per_line,
                        "targetCharsMin": int(chars_per_line * 1.80),
                        "targetCharsMax": target_max,
                    })
    except Exception as e:
        print(f"Error in WeasyPrint orphan detection: {e}")
        return []

    return orphan_data


async def render_node(
    state: ResumeGraphState, db: AsyncSession, gen_id: str
) -> dict[str, Any]:
    await log_progress(
        db,
        gen_id,
        "renderer",
        "Rendering PDF via WeasyPrint & checking page-fit constraints...",
    )

    try:
        from weasyprint import HTML
    except (OSError, ImportError) as e:
        await log_progress(
            db,
            gen_id,
            "renderer",
            f"WeasyPrint failed to load. Pango/Cairo system libraries likely missing: {e}",
            "error",
        )
        raise RuntimeError(
            "PDF rendering is not configured on this host (missing Pango/Cairo libraries)."
        ) from e

    template_manifest = state["template_manifest"]
    template_id = template_manifest["id"]

    if not TemplateRegistryService.get_template_html(template_id):
        raise ValueError(f"Template files for '{template_id}' not found.")

    render_context = {
        "profile": state["profile"],
        "resume": state["tailored_resume"],
        "page_margin_mm": template_manifest.get("page_margin_mm", 15),
    }

    # Perform binary-search over font sizes to auto-fit target page limit
    low = template_manifest.get("min_font_size", 8.0)
    high = template_manifest.get("max_font_size", 12.0)
    target_pages = template_manifest.get("target_pages", 1)

    best_font_size = high
    best_pdf_bytes = None
    best_page_count = 999
    best_doc = None

    for attempt in range(5):
        mid = (low + high) / 2
        html_rendered = TemplateRegistryService.render_template(
            template_id, {**render_context, "font_size": mid}
        )

        doc = HTML(string=html_rendered).render()
        page_count = len(doc.pages)
        await log_progress(
            db,
            gen_id,
            "renderer",
            f"Render attempt {attempt + 1}: font_size={mid:.2f}pt -> page_count={page_count}",
        )

        if page_count <= target_pages:
            # Fits! Save this and try a slightly larger font size to fill the page
            best_font_size = mid
            best_pdf_bytes = doc.write_pdf()
            best_page_count = page_count
            best_doc = doc
            low = mid + 0.25
        else:
            # Overflow, must shrink font
            high = mid - 0.25

    if best_pdf_bytes is None:
        # Fallback to minimum font size if nothing fit within the limit
        await log_progress(
            db,
            gen_id,
            "renderer",
            "Warning: PDF overflowed at maximum constraints. Defaulting to minimum font size.",
            "warning",
        )
        html_rendered = TemplateRegistryService.render_template(
            template_id,
            {**render_context, "font_size": template_manifest.get("min_font_size", 8.0)},
        )
        best_doc = HTML(string=html_rendered).render()
        best_pdf_bytes = best_doc.write_pdf()
        best_page_count = len(best_doc.pages)
        best_font_size = template_manifest.get("min_font_size", 8.0)

    await log_progress(
        db,
        gen_id,
        "renderer",
        f"Render successful: font_size={best_font_size:.2f}pt, page_count={best_page_count}",
    )

    # Detect orphans
    orphans = detect_orphans_in_weasyprint(best_doc)
    if orphans:
        await log_progress(
            db,
            gen_id,
            "renderer",
            f"Orphan detection: found {len(orphans)} orphan/oversize bullet(s).",
            "warning",
        )
    else:
        await log_progress(
            db,
            gen_id,
            "renderer",
            "Orphan detection: no orphan lines found.",
        )

    # Generate Markdown version for history / parsing / raw text copies
    resume = state["tailored_resume"]
    profile = state["profile"]
    md_lines = [f"# {profile.get('full_name', '')}"]

    contacts = [
        x
        for x in [profile.get("email"), profile.get("phone"), profile.get("location")]
        if x
    ]
    if contacts:
        md_lines.append(" | ".join(contacts))

    links = [
        x
        for x in [
            profile.get("linkedin_url"),
            profile.get("github_url"),
            profile.get("portfolio_url"),
        ]
        if x
    ]
    if links:
        md_lines.append(" | ".join(links))

    md_lines.append("")

    if resume.get("summary"):
        md_lines += ["## Professional Summary", resume["summary"], ""]

    if resume.get("skills"):
        md_lines.append("## Skills")
        for category, items in resume["skills"].items():
            skill_list = ", ".join(items) if isinstance(items, list) else str(items)
            md_lines.append(f"**{category}:** {skill_list}")
        md_lines.append("")

    if resume.get("experiences"):
        md_lines.append("## Experience")
        for exp in resume["experiences"]:
            date_range = (
                f"{exp.get('start_date', '')} – {exp.get('end_date') or 'Present'}"
            )
            md_lines.append(f"### {exp.get('role')} — {exp.get('organization')}")
            if exp.get("location"):
                md_lines.append(f"_{exp['location']} | {date_range}_")
            else:
                md_lines.append(f"_{date_range}_")
            for bullet in exp.get("bullet_points") or []:
                md_lines.append(f"- {bullet}")
            md_lines.append("")

    if resume.get("projects"):
        md_lines.append("## Projects")
        for proj in resume["projects"]:
            md_lines.append(f"### {proj.get('name')}")
            if proj.get("technologies"):
                md_lines.append(f"_Technologies: {', '.join(proj['technologies'])}_")
            if proj.get("description"):
                md_lines.append(proj["description"])
            for bullet in proj.get("bullet_points") or []:
                md_lines.append(f"- {bullet}")
            md_lines.append("")

    if resume.get("education"):
        md_lines.append("## Education")
        for edu in resume["education"]:
            date_range = f"{edu.get('start_date', '')} – {edu.get('end_date', '')}"
            md_lines.append(f"### {edu.get('degree')} — {edu.get('institution')}")
            md_lines.append(f"_{date_range}_")
            if edu.get("gpa"):
                md_lines.append(f"GPA: {edu['gpa']}")
            md_lines.append("")

    if resume.get("extracurriculars"):
        md_lines.append("## Extra-Curricular Activities & Achievements")
        for ex in resume["extracurriculars"]:
            date_range = f"{ex.get('start_date', '')} – {ex.get('end_date', '') or 'Present'}"
            md_lines.append(f"### {ex.get('title')} — {ex.get('organization') or ''}")
            md_lines.append(f"_{date_range}_")
            if ex.get("description"):
                md_lines.append(ex["description"])
            for bullet in ex.get("bullet_points") or []:
                md_lines.append(f"- {bullet}")
            md_lines.append("")

    md_content = "\n".join(md_lines)
    return {
        "pdf_bytes": best_pdf_bytes,
        "markdown": md_content,
        "page_count": best_page_count,
        "font_size": best_font_size,
        "orphans": orphans if orphans else None,
    }


async def save_artifacts_node(
    state: ResumeGraphState, db: AsyncSession, gen_id: str
) -> dict[str, Any]:
    await log_progress(
        db, gen_id, "saver", "Uploading artifact files to Cloudflare R2 storage..."
    )

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
        md_uploaded = storage.upload_bytes(
            md_text.encode("utf-8"), md_key, "text/markdown"
        )

    if pdf_uploaded:
        await log_progress(db, gen_id, "saver", f"Uploaded PDF artifact to: {pdf_key}")
    if md_uploaded:
        await log_progress(
            db, gen_id, "saver", f"Uploaded Markdown artifact to: {md_key}"
        )

    await log_progress(
        db, gen_id, "saver", "Generation pipeline successfully completed."
    )

    # Note: caller will mark generation status as 'completed' and save keys
    return {}


async def orphan_repair_node(
    state: ResumeGraphState, db: AsyncSession, gen_id: str
) -> dict[str, Any]:
    orphans = state.get("orphans")
    if not orphans:
        return {}

    await log_progress(
        db,
        gen_id,
        "orphan_repair",
        f"Repairing {len(orphans)} orphan/oversize bullet(s)...",
    )

    experiences = state.get("experience_draft") or []
    projects = state.get("projects_draft") or []
    extracurriculars = state.get("extracurriculars") or []

    def clean_text(s):
        return re.sub(r"\*\*", "", s).strip()

    bullet_blocks = []
    mapping = []

    for idx, orphan in enumerate(orphans, start=1):
        orphan_clean = clean_text(orphan["text"])
        match = None

        # Try to find in experience_draft
        for exp_idx, exp in enumerate(experiences):
            for bullet_idx, bullet in enumerate(exp.get("bullet_points") or []):
                if clean_text(bullet) == orphan_clean:
                    match = ("experience", exp_idx, bullet_idx, bullet)
                    break
            if match:
                break

        # Try to find in projects_draft
        if not match:
            for proj_idx, proj in enumerate(projects):
                for bullet_idx, bullet in enumerate(proj.get("bullet_points") or []):
                    if clean_text(bullet) == orphan_clean:
                        match = ("projects", proj_idx, bullet_idx, bullet)
                        break
                if match:
                    break

        # Try to find in extracurriculars
        if not match:
            for ex_idx, ex in enumerate(extracurriculars):
                for bullet_idx, bullet in enumerate(ex.get("bullet_points") or []):
                    if clean_text(bullet) == orphan_clean:
                        match = ("extracurriculars", ex_idx, bullet_idx, bullet)
                        break
                if match:
                    break

        if not match:
            await log_progress(
                db,
                gen_id,
                "orphan_repair",
                f"Warning: Could not match orphan bullet text back to source drafts: {orphan['text'][:40]}...",
                "warning",
            )
            continue

        section_key, item_idx, bullet_idx, original_md = match

        if section_key == "projects":
            context = f"Project: \"{projects[item_idx].get('name', '')}\""
        elif section_key == "experience":
            context = f"Experience: \"{experiences[item_idx].get('role', '')}\" at {experiences[item_idx].get('organization', '')}"
        else:
            context = f"Extracurricular: \"{extracurriculars[item_idx].get('title', '')}\""

        fix_type = orphan["fix_type"]
        chars_per_line = orphan["charsPerLine"]
        target_min = orphan["targetCharsMin"]
        target_max = orphan["targetCharsMax"]

        PROMPT_BUDGET = 0.92
        prompt_tgt_min = int(target_min * PROMPT_BUDGET)
        prompt_tgt_max = int(target_max * PROMPT_BUDGET)

        if fix_type == "expand":
            chars_to_add_min = max(0, prompt_tgt_min - orphan["currentChars"])
            chars_to_add_max = max(0, prompt_tgt_max - orphan["currentChars"])
            instruction = (
                f"  FIX: EXPAND this bullet so it fills between 1.75 and 1.95 lines in the final PDF.\n"
                f"  One rendered line = {chars_per_line} visible characters.\n"
                f"  Currently renders as {orphan['renderedLines']} lines (orphan line - second line is mostly empty).\n"
                f"  You need to ADD approximately {chars_to_add_min}-{chars_to_add_max} more visible characters.\n"
                f"  Target total: {prompt_tgt_min}-{prompt_tgt_max} visible characters (excluding ** markers).\n"
                f"  HARD MAX: {prompt_tgt_max} visible chars."
            )
        else:
            instruction = (
                f"  FIX: SHORTEN this bullet to fit exactly 2 lines maximum (ideally filling 1.75 to 1.95 lines).\n"
                f"  One rendered line = {chars_per_line} visible characters.\n"
                f"  Currently renders as {orphan['renderedLines']} lines (too long).\n"
                f"  Target total: {prompt_tgt_min}-{prompt_tgt_max} visible characters (excluding ** markers).\n"
                f"  HARD MAX: {prompt_tgt_max} visible chars."
            )

        block = (
            f"Bullet {idx}:\n"
            f"  {context}\n"
            f"  Original: \"{original_md}\"\n"
            f"  Current visible chars: {orphan['currentChars']}\n"
            f"{instruction}"
        )
        bullet_blocks.append(block)
        mapping.append({
            "prompt_index": idx,
            "section_key": section_key,
            "item_idx": item_idx,
            "bullet_idx": bullet_idx,
            "original_md": original_md,
            "target_max": target_max,
        })

    if not bullet_blocks:
        return {"orphans": None, "repair_attempts": state.get("repair_attempts", 0) + 1}

    try:
        kw_text = ", ".join(state["keywords"][:8]) if state["keywords"] else "N/A"
    except Exception:
        kw_text = "N/A"

    prompt = (
        "OUTPUT FORMAT — THIS IS MANDATORY:\n"
        "You MUST respond with ONLY a raw JSON object. No explanation. No prose. No markdown fences.\n"
        "Shape:\n"
        "{\n"
        '  "bullets": [\n'
        '    {"index": 1, "replacement": "Rewritten bullet text here."},\n'
        '    {"index": 2, "replacement": "..."}\n'
        "  ]\n"
        "}\n\n"
        "TASK: Rewrite resume bullet points to fix PDF line-wrap issues.\n"
        "Font: Computer Modern Serif (proportional). Exact character limits given per bullet.\n\n"
        "RULES:\n"
        "- Character counts are VISIBLE characters only. Markdown bold markers (**) do NOT count.\n"
        "- Start every bullet with a strong action verb.\n"
        "- Use markdown bold (e.g. **35%**, **FastAPI**, **400ms**) to highlight all numbers, statistical figures, percentages, key technologies, and key metrics in the bullet points. Every number or metric MUST be bolded.\n"
        "- Add job-relevant technical detail when expanding (use keywords from the job).\n"
        "- Keep the core meaning and factual claims of the original.\n"
        "- Each rewritten bullet MUST stay within its target character range.\n"
        "- No bullet may EVER exceed 2 rendered lines. Respect the HARD MAX.\n"
        "- No emojis.\n\n"
        f"Job-relevant keywords: {kw_text}\n\n"
        + "\n\n".join(bullet_blocks)
        + "\n\n"
        "Respond with ONLY the JSON object shown above. Nothing else."
    )

    llm = get_llm()
    raw_response = ""
    try:
        from langchain_core.messages import SystemMessage, HumanMessage
        messages = [
            SystemMessage(content="You are a precise resume editor. You ONLY output valid JSON. No explanation, no markdown fences."),
            HumanMessage(content=prompt)
        ]
        resp = await llm.ainvoke(messages)
        content = resp.content
        if isinstance(content, list):
            text_parts = []
            for part in content:
                if isinstance(part, str):
                    text_parts.append(part)
                elif isinstance(part, dict) and part.get("type") == "text":
                    text_parts.append(part.get("text", ""))
            raw_response = "".join(text_parts).strip()
        else:
            raw_response = str(content).strip()
    except Exception as e:
        await log_progress(
            db,
            gen_id,
            "orphan_repair",
            f"Error calling LLM for orphan repair: {e}",
            "error",
        )
        return {"orphans": None, "repair_attempts": state.get("repair_attempts", 0) + 1}

    def extract_json(raw_text):
        fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw_text, re.DOTALL)
        if fenced:
            return fenced.group(1).strip()
        start = raw_text.find("{")
        end = raw_text.rfind("}")
        if start != -1 and end != -1:
            return raw_text[start:end+1]
        return raw_text

    applied = 0
    try:
        json_text = extract_json(raw_response)
        result = json.loads(json_text)
        replacements = result.get("bullets", [])

        for repl in replacements:
            idx = repl.get("index")
            new_text = repl.get("replacement", "").strip()
            if not idx or not new_text:
                continue

            entry = next((m for m in mapping if m["prompt_index"] == idx), None)
            if entry is None:
                continue

            visible_len = len(re.sub(r"\*\*", "", new_text))
            if visible_len > entry["target_max"] * 1.05:
                await log_progress(
                    db,
                    gen_id,
                    "orphan_repair",
                    f"Warning: Repaired bullet {idx} too long ({visible_len} > {entry['target_max']}), skipping.",
                    "warning",
                )
                continue

            section_key = entry["section_key"]
            item_idx = entry["item_idx"]
            bullet_idx = entry["bullet_idx"]

            if section_key == "experience":
                experiences[item_idx]["bullet_points"][bullet_idx] = new_text
            elif section_key == "projects":
                projects[item_idx]["bullet_points"][bullet_idx] = new_text
            elif section_key == "extracurriculars":
                extracurriculars[item_idx]["bullet_points"][bullet_idx] = new_text
            
            applied += 1

        await log_progress(
            db,
            gen_id,
            "orphan_repair",
            f"Successfully repaired and applied {applied}/{len(mapping)} bullet point(s).",
        )
    except Exception as e:
        await log_progress(
            db,
            gen_id,
            "orphan_repair",
            f"Error parsing LLM repair response: {e}. Raw response:\n{raw_response}",
            "error",
        )

    return {
        "experience_draft": experiences,
        "projects_draft": projects,
        "extracurriculars": extracurriculars,
        "orphans": None,
        "repair_attempts": state.get("repair_attempts", 0) + 1,
    }

