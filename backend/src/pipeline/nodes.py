import asyncio
import ast
import gc
import io
import json
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from jinja2 import Template
from langchain_core.prompts import ChatPromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings  # noqa: F401 (kept for other settings usage)
from src.core.database import AsyncSessionLocal
from src.core.storage import StorageService
from src.models.generation import Generation, GenerationLog, GenerationNodeMetric, PromptConfig
from src.services.font_fit import find_best_font_size
from src.services.resume_render import build_resume_markdown
from src.pipeline.state import ResumeGraphState
from src.schemas.pipeline import (
    JobAnalysis,
    SelectedItems,
    TailoredExperience,
    TailoredExperienceBatch,
    TailoredExtracurricularBatch,
    TailoredProject,
    TailoredProjectBatch,
    TailoredSummaryAndSkills,
)
from src.template_registry.service import TemplateRegistryService

# ── Log Helper ────────────────────────────────────────────────────────────────


async def log_progress(
    db: AsyncSession, gen_id: str, node_name: str, message: str, level: str = "info"
):
    print(f"[{node_name}] {message}")
    # Use a fresh session per log insert to avoid concurrent commit conflicts.
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


# ── LLM Init Helper ───────────────────────────────────────────────────────────

from src.services.llm_config import llm_config_service


def _structured(llm, schema, provider: str | None = None):
    """Structured output with provider-appropriate method."""
    return llm.with_structured_output(schema)

def _extract_token_usage(result: Any) -> tuple[int | None, int | None, int | None]:
    metadata = getattr(result, "response_metadata", None) or {}
    usage = metadata.get("token_usage") or metadata.get("usage_metadata") or getattr(result, "usage_metadata", None) or {}
    prompt_tokens = usage.get("prompt_tokens") or usage.get("input_tokens")
    completion_tokens = usage.get("completion_tokens") or usage.get("output_tokens")
    total_tokens = usage.get("total_tokens") or usage.get("total_token_count")
    return prompt_tokens, completion_tokens, total_tokens


def _is_parse_error(exc: Exception) -> bool:
    text = f"{exc.__class__.__name__}: {exc}".lower()
    return any(part in text for part in ["validation", "parse", "parser", "json", "schema"])


def _replace_prompt_vars(prompt: str, values: dict[str, str]) -> str:
    """Replace explicit prompt placeholders without interpreting literal JSON braces."""
    for key, value in values.items():
        prompt = prompt.replace("{" + key + "}", value)
    return prompt


def _clean_skill_category(category: Any) -> str:
    text = re.sub(r"[_\-]+", " ", str(category or "")).strip()
    text = re.sub(r"\s+", " ", text)
    words = []
    for word in text.split(" "):
        if word.isupper() or "/" in word:
            words.append(word)
        else:
            words.append(word[:1].upper() + word[1:])
    return " ".join(words)


def _coerce_skill_items(items: Any) -> list[str]:
    if items is None:
        return []

    if isinstance(items, str):
        text = items.strip()
        if text.startswith("[") and text.endswith("]"):
            try:
                parsed = ast.literal_eval(text)
                if isinstance(parsed, (list, tuple)):
                    items = parsed
                else:
                    items = [text]
            except (ValueError, SyntaxError):
                items = [text.strip("[]")]
        else:
            items = [part.strip() for part in text.split(",")]
    elif not isinstance(items, (list, tuple, set)):
        items = [items]

    cleaned = []
    seen = set()
    for item in items:
        if isinstance(item, (list, tuple, set)):
            candidates = _coerce_skill_items(item)
        else:
            candidates = [str(item)]
        for candidate in candidates:
            skill = candidate.strip().strip("[]'")
            skill = re.sub(r"\s+", " ", skill)
            if not skill or skill in seen:
                continue
            seen.add(skill)
            cleaned.append(skill)
    return cleaned


def _normalize_skills(skills: Any) -> dict[str, list[str]]:
    if not isinstance(skills, dict):
        return {}

    normalized: dict[str, list[str]] = {}
    for category, items in skills.items():
        clean_category = _clean_skill_category(category)
        clean_items = _coerce_skill_items(items)
        if not clean_category or not clean_items:
            continue
        if clean_category in normalized:
            normalized[clean_category].extend(
                item for item in clean_items if item not in normalized[clean_category]
            )
        else:
            normalized[clean_category] = clean_items
    return normalized


async def record_node_metric(
    gen_id: str | None,
    node_name: str | None,
    provider: str,
    model: str | None,
    status: str,
    latency_ms: float,
    fallback_used: bool,
    parse_error: bool = False,
    error_message: str | None = None,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    total_tokens: int | None = None,
) -> None:
    if not gen_id or not node_name:
        return
    async with AsyncSessionLocal() as metric_session:
        await metric_session.execute(
            insert(GenerationNodeMetric).values(
                generation_id=uuid.UUID(gen_id),
                node_name=node_name,
                provider=provider,
                model=model,
                status=status,
                latency_ms=latency_ms,
                fallback_used=fallback_used,
                parse_error=parse_error,
                error_message=error_message,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                created_at=datetime.now(timezone.utc),
            )
        )
        await metric_session.commit()


async def invoke_with_fallback(
    chain_factory,
    invoke_args,
    timeout: float = 40.0,
    node_name: str | None = None,
    gen_id: str | None = None,
    max_attempts_per_provider: int = 2,
    is_pro: bool = False,
):
    """Retry each provider call before falling back to the next provider.

    chain_factory(llm, provider_name) -> a runnable chain.
    Dynamically uses Pro (OmniRoute Gemini 3.7) or Free (OpenRouter Laguna)
    with fallback to Google GenAI.
    """
    tier = "pro" if is_pro else "free"
    cfg = llm_config_service.get_tier_config(tier)

    # Dynamically determine provider name from configured endpoint
    url_lower = cfg.base_url.lower()
    is_openrouter = "openrouter.ai" in url_lower
    if is_openrouter:
        primary_name = "openrouter"
    elif "omniroute" in url_lower:
        primary_name = "omniroute"
    elif cfg.provider_name and cfg.provider_name not in ("openai_compatible", "default"):
        primary_name = cfg.provider_name
    else:
        primary_name = "custom_endpoint"

    providers = [
        (primary_name, lambda: llm_config_service.get_llm(tier=tier)),
        ("google", lambda: llm_config_service.get_fallback_llm(tier=tier)),
    ]
    # Only append OpenRouter fallback if primary is not already OpenRouter
    if is_pro and not is_openrouter:
        providers.append(("openrouter", lambda: llm_config_service.get_llm(tier="free")))
    last_exc: Exception | None = None
    for index, (name, factory) in enumerate(providers):
        llm = None
        try:
            llm = factory()
        except Exception as exc:
            last_exc = exc
            print(f"[llm_fallback] {name} initialization failed ({exc!r}).")
            continue

        chain = chain_factory(llm, name)
        for attempt in range(1, max_attempts_per_provider + 1):
            started = time.perf_counter()
            try:
                result = await asyncio.wait_for(chain.ainvoke(invoke_args), timeout=timeout)
                prompt_tokens, completion_tokens, total_tokens = _extract_token_usage(result)
                await record_node_metric(
                    gen_id,
                    node_name,
                    name,
                    getattr(llm, "model_name", None) or getattr(llm, "model", None),
                    "success",
                    (time.perf_counter() - started) * 1000,
                    fallback_used=index > 0,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    total_tokens=total_tokens,
                )
                return result
            except Exception as exc:
                last_exc = exc
                await record_node_metric(
                    gen_id,
                    node_name,
                    name,
                    getattr(llm, "model_name", None) or getattr(llm, "model", None),
                    "error",
                    (time.perf_counter() - started) * 1000,
                    fallback_used=index > 0,
                    parse_error=_is_parse_error(exc),
                    error_message=f"attempt {attempt}/{max_attempts_per_provider}: {str(exc)[:1900]}",
                )
                if attempt < max_attempts_per_provider:
                    sleep_for = min(0.75 * (2 ** (attempt - 1)), 3.0)
                    print(f"[llm_retry] {name} attempt {attempt} failed ({exc!r}). Retrying same call in {sleep_for:.2f}s...")
                    await asyncio.sleep(sleep_for)

        print(f"[llm_fallback] {name} exhausted {max_attempts_per_provider} attempts. Falling back to next provider...")
    raise RuntimeError(f"All LLM providers failed. Last error: {last_exc!r}") from last_exc

async def get_prompt_config(db: AsyncSession, name: str, default_system: str, default_user: str | None = None) -> tuple[str, str | None]:
    try:
        result = await db.execute(select(PromptConfig).where(PromptConfig.name == name))
        cfg = result.scalar_one_or_none()
        if cfg:
            if "OUTPUT CONTRACT:" not in cfg.system_prompt:
                cfg.system_prompt = default_system
                cfg.user_prompt = default_user
                await db.commit()
                return default_system, default_user
            return cfg.system_prompt, cfg.user_prompt
        
        cfg = PromptConfig(name=name, system_prompt=default_system, user_prompt=default_user)
        db.add(cfg)
        await db.commit()
        return default_system, default_user
    except Exception as e:
        print(f"Error fetching prompt config '{name}': {e}")
        return default_system, default_user


# ── Graph Nodes ───────────────────────────────────────────────────────────────


async def job_analysis_node(
    state: ResumeGraphState, db: AsyncSession, gen_id: str
) -> dict[str, Any]:
    await log_progress(
        db, gen_id, "job_analysis", "Starting job description analysis..."
    )

    sys_prompt, usr_prompt = await get_prompt_config(
        db,
        "job_analysis",
        default_system=(
            "ROLE: Senior technical recruiter and resume-targeting analyst.\n"
            "TASK: Convert a job description into a compact, factual targeting brief for downstream resume generation.\n"
            "OUTPUT CONTRACT: Return only the structured JobAnalysis object with these fields: job_title, company, seniority, key_requirements, extracted_skills.\n"
            "RULES:\n"
            "- Extract facts from the job description first; do not invent company-specific details.\n"
            "- If company is absent, use 'Unknown Company'.\n"
            "- Infer seniority conservatively from title, years, scope, and responsibility.\n"
            "- key_requirements: 5-10 concise responsibility/qualification phrases, ordered by hiring importance.\n"
            "- extracted_skills: technical tools, domains, methods, and important soft skills explicitly stated or strongly implied.\n"
            "- Merge duplicates and normalize variants, e.g. 'JS' to 'JavaScript'.\n"
            "- No prose outside the structured output."
        ),
        default_user=(
            "INPUT: Job Description\n{job_desc}\n\n"
            "INPUT: User Keywords / Focus\n{keywords}\n\n"
            "INPUT: Additional Instructions\n{instructions}"
        ),
    )
    prompt = ChatPromptTemplate.from_messages([("system", sys_prompt), ("user", usr_prompt)])

    result = await invoke_with_fallback(
        lambda llm, p: prompt | _structured(llm, JobAnalysis, p),
        {
            "job_desc": state["job_description"],
            "keywords": ", ".join(state["keywords"]) if state["keywords"] else "None",
            "instructions": state["instructions"] or "None",
        },
        node_name="job_analysis",
        gen_id=gen_id,
        is_pro=state.get("is_pro", False),
    )

    await log_progress(
        db,
        gen_id,
        "job_analysis",
        f"Extracted Job Title: '{result.job_title}' at '{result.company}'",
    )
    return {"job_analysis": result.model_dump()}


async def selection_node(
    state: ResumeGraphState, db: AsyncSession, gen_id: str
) -> dict[str, Any]:
    await log_progress(
        db, gen_id, "selection", "Analyzing candidate experience and projects for relevance..."
    )

    experiences = state.get("experiences") or []
    projects = state.get("projects") or []

    if not experiences and not projects:
        await log_progress(db, gen_id, "selection", "No experiences or projects to select.")
        return {}

    # Use content_split (exact user choice enforced by backend) — not manifest maxes.
    content_split = state.get("content_split") or {}
    max_exp = content_split.get("experience", 2)
    max_proj = content_split.get("projects", 2)

    exp_list_str = []
    for idx, exp in enumerate(experiences):
        bullets = "; ".join(exp.get("bullet_points") or [])
        exp_list_str.append(
            f"Index {idx}: Role: '{exp.get('role')}', Organization: '{exp.get('organization')}', "
            f"Bullets: {bullets}"
        )

    proj_list_str = []
    for idx, proj in enumerate(projects):
        bullets = "; ".join(proj.get("bullet_points") or [])
        techs = ", ".join(proj.get("technologies") or [])
        proj_list_str.append(
            f"Index {idx}: Name: '{proj.get('name')}', Technologies: [{techs}], "
            f"Description: '{proj.get('description') or ''}', Bullets: {bullets}"
        )

    sys_prompt, usr_prompt = await get_prompt_config(
        db,
        "selection",
        default_system=(
            "ROLE: Technical recruiter ranking candidate evidence for one target job.\n"
            "TASK: Select resume source entries that best prove fit for the job analysis.\n"
            "OUTPUT CONTRACT: Return only the structured SelectedItems object with selected_experience_indices and selected_project_indices.\n"
            "RULES:\n"
            "- Select EXACTLY {max_exp} experience indices and EXACTLY {max_proj} project indices when enough entries exist.\n"
            "- If fewer entries exist than requested, select all valid entries of that type.\n"
            "- Use 0-based indices only. Never invent, duplicate, or use out-of-range indices.\n"
            "- Order each list by relevance, strongest first.\n"
            "- Prefer entries with direct skill overlap, domain similarity, measurable impact, recent work, and seniority match.\n"
            "- Do not rewrite content here. Only select indices.\n"
            "- No prose outside the structured output."
        ),
        default_user=(
            "INPUT: Target Job Title\n{job_title}\n\n"
            "INPUT: Key Requirements\n{requirements}\n\n"
            "INPUT: Extracted Skills\n{skills}\n\n"
            "INPUT: Candidate Experiences\n{experiences}\n\n"
            "INPUT: Candidate Projects\n{projects}"
        )
    )
    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", sys_prompt.format(max_exp=max_exp, max_proj=max_proj)),
            ("user", usr_prompt),
        ]
    )

    job_analysis = state.get("job_analysis") or {}
    requirements = ", ".join(job_analysis.get("key_requirements") or [])
    skills = ", ".join(job_analysis.get("extracted_skills") or [])

    result = await invoke_with_fallback(
        lambda llm, p: prompt | _structured(llm, SelectedItems, p),
        {
            "job_title": job_analysis.get("job_title") or "Target Role",
            "requirements": requirements,
            "skills": skills,
            "experiences": "\n".join(exp_list_str) if exp_list_str else "None",
            "projects": "\n".join(proj_list_str) if proj_list_str else "None",
        },
        node_name="selection",
        gen_id=gen_id,
        is_pro=state.get("is_pro", False),
    )

    # ── Backend enforcement: clamp to exact split limits, dedup, fill gaps ────
    selected_experiences = []
    seen_exp_idx = set()
    for idx in result.selected_experience_indices:
        if len(selected_experiences) >= max_exp:
            break
        if 0 <= idx < len(experiences) and idx not in seen_exp_idx:
            selected_experiences.append(experiences[idx])
            seen_exp_idx.add(idx)

    # Fill remaining slots from pool if AI returned too few.
    for idx, exp in enumerate(experiences):
        if len(selected_experiences) >= max_exp:
            break
        if idx not in seen_exp_idx:
            selected_experiences.append(exp)
            seen_exp_idx.add(idx)

    # Hard cap — never exceed the user-chosen limit.
    selected_experiences = selected_experiences[:max_exp]

    selected_projects = []
    seen_proj_idx = set()
    for idx in result.selected_project_indices:
        if len(selected_projects) >= max_proj:
            break
        if 0 <= idx < len(projects) and idx not in seen_proj_idx:
            selected_projects.append(projects[idx])
            seen_proj_idx.add(idx)

    for idx, proj in enumerate(projects):
        if len(selected_projects) >= max_proj:
            break
        if idx not in seen_proj_idx:
            selected_projects.append(proj)
            seen_proj_idx.add(idx)

    selected_projects = selected_projects[:max_proj]

    await log_progress(
        db,
        gen_id,
        "selection",
        f"Selected {len(selected_experiences)}/{max_exp} experience(s) and {len(selected_projects)}/{max_proj} project(s) based on relevance.",
    )

    return {
        "experiences": selected_experiences,
        "projects": selected_projects,
    }


async def summary_skills_node(
    state: ResumeGraphState, db: AsyncSession, gen_id: str
) -> dict[str, Any]:
    await log_progress(
        db,
        gen_id,
        "summary_skills",
        "Generating tailored summary & categorizing skills...",
    )

    sys_prompt, usr_prompt = await get_prompt_config(
        db,
        "summary_skills",
        default_system=(
            "ROLE: Senior resume writer optimizing top-of-resume positioning for ATS and human reviewers.\n"
            "TASK: Write a concise targeted summary and categorized skills from candidate material and job analysis.\n"
            "OUTPUT CONTRACT: Return only the structured TailoredSummaryAndSkills object with summary and categories.\n"
            "RULES:\n"
            "- summary: exactly 1-2 sentences, maximum 30 words, no first person, no fluff.\n"
            "- Anchor summary in candidate evidence and job priorities; do not claim unsupported years, degrees, employers, or certifications.\n"
            "- categories: 3-6 skill categories total (e.g. Languages, Frontend, Backend, Tools, Soft Skills). Must include a 'Soft Skills' category.\n"
            "- Each category must have a category name and a list of short skill names.\n"
            "- Prioritize job-matching skills first; include plausible demonstrated skills, not random keyword stuffing.\n"
            "- No prose outside the structured output."
        ),
        default_user=(
            "INPUT: Job Analysis\n{job_analysis}\n\n"
            "INPUT: Candidate Skills\n{candidate_skills}\n\n"
            "INPUT: Candidate Existing Summary\n{candidate_summary}"
        )
    )
    prompt = ChatPromptTemplate.from_messages([("system", sys_prompt), ("user", usr_prompt)])

    result = await invoke_with_fallback(
        lambda llm, p: prompt | _structured(llm, TailoredSummaryAndSkills, p),
        {
            "job_analysis": str(state["job_analysis"]),
            "candidate_skills": ", ".join(state["profile"].get("skills") or []),
            "candidate_summary": state["profile"].get("summary") or "",
        },
        node_name="summary_skills",
        gen_id=gen_id,
        is_pro=state.get("is_pro", False),
    )

    await log_progress(
        db,
        gen_id,
        "summary_skills",
        "Successfully tailored summary and grouped skills.",
    )
    summary_draft = result.model_dump()
    skills_dict = summary_draft.get("skills") or {}
    if not skills_dict and summary_draft.get("categories"):
        skills_dict = {
            c.get("category", "General"): c.get("skills", [])
            for c in summary_draft["categories"]
            if isinstance(c, dict) and c.get("category")
        }
    summary_draft["skills"] = _normalize_skills(skills_dict)
    return {"summary_draft": summary_draft}


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

    max_exp = state.get("content_split", {}).get("experience", 2)
    max_bullets = state["template_manifest"].get("max_bullets_per_experience", 4)
    job_analysis = str(state["job_analysis"])
    batch = experiences[:max_exp]

    entries_text = ""
    for i, exp in enumerate(batch, start=1):
        entries_text += (
            f"\n--- Entry {i} ---\n"
            f"Role: {exp['role']}\nCompany: {exp['organization']}\n"
            f"Bullet Points:\n" + "\n".join(exp.get("bullet_points") or []) + "\n"
        )

    sys_prompt, usr_prompt = await get_prompt_config(
        db,
        "experience_writer",
        default_system=(
            "ROLE: Senior technical resume writer.\n"
            "TASK: Rewrite selected experience entries to prove fit for the target job while preserving truth.\n"
            "OUTPUT CONTRACT: Return only the structured TailoredExperienceBatch object with entries. Return EXACTLY {batch_len} entries in input order.\n"
            "RULES:\n"
            "- Preserve role, organization, dates, and location unless input is missing.\n"
            "- Each entry should contain 2-4 bullet_points, limited by available source material.\n"
            "- Start every bullet with a strong past-tense action verb.\n"
            "- Emphasize job-relevant technologies, scope, outcomes, collaboration, ownership, and measurable impact.\n"
            "- Do not invent employers, products, metrics, users, revenue, or credentials. You may reframe existing evidence.\n"
            "- Bold every number, statistic, percentage, metric, and key technology with markdown asterisks, e.g. **35%**, **FastAPI**, **400ms**.\n"
            "- Line-fit: each bullet should fit on one line or fill 1.75-1.95 rendered lines. Avoid short orphan second lines.\n"
            "- Keep bullets concise, specific, and ATS-readable. No periods required.\n"
            "- No prose outside the structured output."
        ),
        default_user=(
            "INPUT: Job Analysis\n{job_analysis}\n\n"
            "INPUT: Experience Entries To Rewrite\n{entries}"
        )
    )
    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", sys_prompt.format(batch_len=len(batch))),
            ("user", usr_prompt),
        ]
    )

    await log_progress(db, gen_id, "experience_writer", f"Tailoring {len(batch)} experience entries in one batch...")
    result = await invoke_with_fallback(
        lambda llm, p: prompt | _structured(llm, TailoredExperienceBatch, p),
        {"job_analysis": job_analysis, "entries": entries_text},
        node_name="experience_writer",
        gen_id=gen_id,
        is_pro=state.get("is_pro", False),
    )

    tailored_exps = []
    for i, tailored in enumerate(result.entries[:max_exp]):
        original = batch[i]
        tailored_exps.append({
            "role": tailored.role,
            "organization": tailored.organization,
            "location": original.get("location") or tailored.location,
            "start_date": original.get("start_date") or tailored.start_date,
            "end_date": original.get("end_date") or tailored.end_date,
            "bullet_points": tailored.bullet_points[:max_bullets],
        })

    await log_progress(db, gen_id, "experience_writer", "Finished tailoring all experience entries.")
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

    max_proj = state.get("content_split", {}).get("projects", 2)
    max_bullets = state["template_manifest"].get("max_bullets_per_project", 3)
    job_analysis = str(state["job_analysis"])
    batch = projects[:max_proj]

    entries_text = ""
    for i, proj in enumerate(batch, start=1):
        entries_text += (
            f"\n--- Project {i} ---\n"
            f"Name: {proj['name']}\n"
            f"Description: {proj.get('description') or ''}\n"
            f"Technologies: {', '.join(proj.get('technologies') or [])}\n"
            f"Bullet Points:\n" + "\n".join(proj.get("bullet_points") or []) + "\n"
        )

    sys_prompt, usr_prompt = await get_prompt_config(
        db,
        "projects_writer",
        default_system=(
            "ROLE: Senior technical resume writer specializing in project sections.\n"
            "TASK: Rewrite selected project entries so they map clearly to target job requirements.\n"
            "OUTPUT CONTRACT: Return only the structured TailoredProjectBatch object with entries. Return EXACTLY {batch_len} entries in input order.\n"
            "RULES:\n"
            "- Preserve project name unless spelling cleanup is needed.\n"
            "- project_summary: 2-4 words describing the project category, e.g. 'API Automation Platform'.\n"
            "- description: one concise sentence explaining what the project does and why it matters.\n"
            "- technologies: normalized list of technologies from input plus clearly supported technologies only.\n"
            "- bullet_points: 2-3 concise achievement bullets, each starting with a strong action verb.\n"
            "- Emphasize architecture, implementation depth, job-relevant tools, measurable performance, users, scale, or impact when supported.\n"
            "- Do not invent metrics, deployments, users, awards, or technologies not supported by input.\n"
            "- Bold every number, statistic, percentage, metric, and key technology with markdown asterisks.\n"
            "- Line-fit: each bullet should fit on one line or fill 1.75-1.95 rendered lines. Avoid short orphan second lines.\n"
            "- No prose outside the structured output."
        ),
        default_user=(
            "INPUT: Job Analysis\n{job_analysis}\n\n"
            "INPUT: Project Entries To Rewrite\n{entries}"
        )
    )
    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", sys_prompt.format(batch_len=len(batch))),
            ("user", usr_prompt),
        ]
    )

    result = await invoke_with_fallback(
        lambda llm, p: prompt | _structured(llm, TailoredProjectBatch, p),
        {"job_analysis": job_analysis, "entries": entries_text},
        node_name="projects_writer",
        gen_id=gen_id,
        is_pro=state.get("is_pro", False),
    )

    tailored_projs = []
    for i, tailored in enumerate(result.entries[:max_proj]):
        original = batch[i]
        tailored_projs.append({
            "name": tailored.name,
            "project_summary": tailored.project_summary,
            "description": tailored.description,
            "technologies": tailored.technologies,
            "bullet_points": tailored.bullet_points[:max_bullets],
            "github_url": original.get("github_url"),
            "live_url": original.get("live_url"),
            "start_date": original.get("start_date"),
            "end_date": original.get("end_date"),
        })

    await log_progress(db, gen_id, "projects_writer", "Finished tailoring all project entries.")
    return {"projects_draft": tailored_projs}


async def extracurricular_node(
    state: ResumeGraphState, db: AsyncSession, gen_id: str
) -> dict[str, Any]:
    await log_progress(
        db, gen_id, "extracurricular_writer", "Tailoring extracurricular entries..."
    )

    extracurriculars = state.get("extracurriculars") or []
    if not extracurriculars:
        await log_progress(db, gen_id, "extracurricular_writer", "No extracurriculars to tailor.")
        return {"extracurriculars_draft": []}

    # Filter out entries that are just section headers (e.g. "Achievements")
    valid_entries = [
        ex for ex in extracurriculars
        if ex.get("title", "").strip().lower() not in {
            "achievements", "activities", "extra-curricular",
            "extracurricular", "awards", "honors",
        }
    ]

    if not valid_entries:
        await log_progress(db, gen_id, "extracurricular_writer", "No valid extracurriculars after filtering headers.")
        return {"extracurriculars_draft": []}

    batch = valid_entries[:3]
    job_analysis = str(state["job_analysis"])

    entries_text = ""
    for i, ex in enumerate(batch, start=1):
        bullets = "\n".join(ex.get("bullet_points") or [])
        entries_text += (
            f"\n--- Entry {i} ---\n"
            f"Title: {ex.get('title', '')}\n"
            f"Organization: {ex.get('organization', '')}\n"
            f"Description: {ex.get('description', '')}\n"
            f"Start Date: {ex.get('start_date', '')}\n"
            f"End Date: {ex.get('end_date', '')}\n"
            f"Details:\n{bullets}\n"
        )

    sys_prompt, usr_prompt = await get_prompt_config(
        db,
        "extracurricular_writer",
        default_system=(
            "ROLE: Resume editor for achievements, activities, and extracurricular entries.\n"
            "TASK: Convert each input entry into one polished resume sentence.\n"
            "OUTPUT CONTRACT: Return only the structured TailoredExtracurricularBatch object with entries. Return EXACTLY {batch_len} entries in input order.\n"
            "RULES:\n"
            "- Each description must be exactly one sentence.\n"
            "- Start with a strong action verb when possible.\n"
            "- Include organization, event, award, scope, or measurable impact if present in input.\n"
            "- Do not output section headers such as Achievements, Activities, Awards, or Honors.\n"
            "- Do not copy raw title verbatim; rewrite into natural resume language.\n"
            "- Do not invent rankings, attendance, dates, awards, or impact.\n"
            "- Keep sentence concise enough for one resume bullet.\n"
            "- No prose outside the structured output."
        ),
        default_user=(
            "INPUT: Job Analysis\n{job_analysis}\n\n"
            "INPUT: Extracurricular Entries To Rewrite\n{entries}"
        )
    )
    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", sys_prompt.format(batch_len=len(batch))),
            ("user", usr_prompt),
        ]
    )
    result = await invoke_with_fallback(
        lambda llm, p: prompt | _structured(llm, TailoredExtracurricularBatch, p),
        {"job_analysis": job_analysis, "entries": entries_text},
        node_name="extracurricular_writer",
        gen_id=gen_id,
        is_pro=state.get("is_pro", False),
    )
    tailored = [
        {"description": entry.description}
        for entry in result.entries[:3]
    ]

    await log_progress(db, gen_id, "extracurricular_writer", "Finished tailoring extracurricular entries.")
    return {"extracurriculars_draft": tailored}


async def assembly_node(
    state: ResumeGraphState, db: AsyncSession, gen_id: str
) -> dict[str, Any]:
    await log_progress(
        db, gen_id, "assembly", "Assembling tailored resume structure..."
    )

    summary_draft = state["summary_draft"] or {}
    experiences = state["experience_draft"] or []
    projects = state["projects_draft"] or []

    # ── Hard final clamp — backend always wins, AI output irrelevant ──────────
    content_split = state.get("content_split") or {}
    max_exp = content_split.get("experience", len(experiences))
    max_proj = content_split.get("projects", len(projects))
    experiences = experiences[:max_exp]
    projects = projects[:max_proj]

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

    # Map extracurriculars — use LLM-tailored descriptive sentences.
    extracurriculars = state.get("extracurriculars_draft") or []

    tailored_resume = {
        "summary": summary_draft.get("summary"),
        "skills": _normalize_skills(summary_draft.get("skills")),
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

                # Derive chars-per-line from the first (full) line — accurate per font/size,
                # unlike a hardcoded avg-char-width constant that drifts with the loaded font.
                first_line_text = get_text(lines[0][0]).strip()
                if first_line_text and full_width > 0:
                    chars_per_line = len(first_line_text)
                else:
                    chars_per_line = 90

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

    # Discrete 0.05pt binary search via shared font_fit utility.
    min_fs = template_manifest.get("min_font_size", 8.0)
    max_fs = template_manifest.get("max_font_size", 12.0)
    target_pages = template_manifest.get("target_pages", 1)
    font_base_url = str(settings.TEMPLATES_DIR / template_id)

    # Probe state: keep only the most recent *fitting* doc in memory.
    # Overflow docs are freed immediately (mirrors original render_node GC pattern).
    _last_fit_doc: list = [None]   # list-cell trick for closure mutation
    attempt_counter = [0]

    def _render_page_count(font_size: float) -> int:
        attempt_counter[0] += 1
        html_rendered = TemplateRegistryService.render_template(
            template_id, {**render_context, "font_size": font_size}
        )
        doc = HTML(string=html_rendered, base_url=font_base_url).render()
        pages = len(doc.pages)
        if pages <= target_pages:
            # Fits — replace cached doc; old doc freed by reference drop
            _last_fit_doc[0] = doc
        else:
            # Overflow — discard immediately
            del doc
        return pages

    fit_result = find_best_font_size(
        render_page_count=_render_page_count,
        min_font_size=min_fs,
        max_font_size=max_fs,
        target_pages=target_pages,
    )

    await log_progress(
        db,
        gen_id,
        "renderer",
        f"Font fit: {attempt_counter[0]} probes, best={fit_result.font_size:.2f}pt, "
        f"pages={fit_result.page_count}, fits={fit_result.fits_target}",
    )

    if not fit_result.fits_target:
        await log_progress(
            db,
            gen_id,
            "renderer",
            "Warning: overflow at minimum font size; defaulting to minimum.",
            "warning",
        )

    best_font_size = fit_result.font_size
    best_page_count = fit_result.page_count

    # Use cached fitting doc if available; otherwise re-render (overflow-only case)
    best_doc = _last_fit_doc[0]
    if best_doc is not None:
        best_pdf_bytes = best_doc.write_pdf()
    else:
        html_rendered = TemplateRegistryService.render_template(
            template_id, {**render_context, "font_size": best_font_size}
        )
        best_doc = HTML(string=html_rendered, base_url=font_base_url).render()
        best_pdf_bytes = best_doc.write_pdf()
        best_page_count = len(best_doc.pages)

    # Force GC to reclaim WeasyPrint/Cairo objects from discarded render iterations
    gc.collect()

    await log_progress(
        db,
        gen_id,
        "renderer",
        f"Render successful: font_size={best_font_size:.2f}pt, page_count={best_page_count}",
    )

    # Detect orphans
    orphans = detect_orphans_in_weasyprint(best_doc)
    if orphans:
        if state.get("repair_attempts", 0) == 0:
            try:
                gen_uuid = uuid.UUID(gen_id)
                gen = await db.get(Generation, gen_uuid)
                if gen:
                    metadata = dict(gen.render_metadata or {})
                    intermediates = list(metadata.get("intermediate_resumes") or [])
                    intermediates.append(
                        {
                            "label": "Before orphan repair",
                            "tailored_resume": state["tailored_resume"],
                            "font_size": best_font_size,
                            "page_count": best_page_count,
                            "orphans": orphans,
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        }
                    )
                    metadata["intermediate_resumes"] = intermediates
                    gen.render_metadata = metadata
                    await db.commit()
            except Exception as e:
                await log_progress(
                    db,
                    gen_id,
                    "renderer",
                    f"Intermediate resume snapshot skipped: {e}",
                    "warning",
                )
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

    # Generate Markdown version via shared helper
    md_content = build_resume_markdown(
        profile=state["profile"],
        resume=state["tailored_resume"],
    )
    return {
        "pdf_bytes": best_pdf_bytes,
        "markdown": md_content,
        "page_count": best_page_count,
        "font_size": best_font_size,
        "orphans": orphans if orphans else None,
    }


async def content_reduction_node(
    state: ResumeGraphState, db: AsyncSession, gen_id: str
) -> dict[str, Any]:
    """Remove bullet points to fit resume within target page count.

    Step 0: Remove last bullet from 2nd experience entry.
    Step 1: Remove last bullet from 2nd project entry.
    Step 2+: No more reductions possible — caller should treat as error.
    """
    step = state.get("content_reduction_step", 0)
    experiences = list(state.get("experience_draft") or [])
    projects = list(state.get("projects_draft") or [])

    if step == 0:
        # Try removing 1 bullet from 2nd experience
        if len(experiences) > 1 and len(experiences[1].get("bullet_points", [])) > 1:
            removed = experiences[1]["bullet_points"].pop()
            await log_progress(
                db,
                gen_id,
                "content_reduction",
                f"Page overflow: removed 1 bullet from experience '{experiences[1]['role']}' "
                f"({len(experiences[1]['bullet_points'])} remaining).",
                "warning",
            )
        else:
            await log_progress(
                db,
                gen_id,
                "content_reduction",
                "Page overflow: 2nd experience has ≤1 bullet, skipping to project reduction.",
                "warning",
            )

        return {
            "experience_draft": experiences,
            "content_reduction_step": 1,
        }

    elif step == 1:
        # Try removing 1 bullet from 2nd project
        if len(projects) > 1 and len(projects[1].get("bullet_points", [])) > 1:
            removed = projects[1]["bullet_points"].pop()
            await log_progress(
                db,
                gen_id,
                "content_reduction",
                f"Page overflow: removed 1 bullet from project '{projects[1]['name']}' "
                f"({len(projects[1]['bullet_points'])} remaining).",
                "warning",
            )
        else:
            await log_progress(
                db,
                gen_id,
                "content_reduction",
                "Page overflow: 2nd project has ≤1 bullet, no further reduction possible.",
                "warning",
            )

        return {
            "projects_draft": projects,
            "content_reduction_step": 2,
        }

    # Step 2+: exhausted all reductions
    await log_progress(
        db,
        gen_id,
        "content_reduction",
        "Content reduction exhausted. Resume still exceeds target page count.",
        "error",
    )
    return {
        "content_reduction_step": step + 1,
        "errors": (state.get("errors") or [])
        + ["Resume content too long to fit target page count after all reductions."],
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
    thumb_key = f"runs/{gen_id}/thumb.webp"

    storage = StorageService()
    pdf_uploaded = False
    md_uploaded = False
    thumb_uploaded = False

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

    # Generate WebP thumbnail from page 1 of the PDF (non-fatal)
    if pdf_bytes and pdf_uploaded:
        try:
            import pypdfium2 as pdfium
            pdf_doc = pdfium.PdfDocument(pdf_bytes)
            page = pdf_doc[0]
            scale = 400 / page.get_width()
            bitmap = page.render(scale=scale, rotation=0)
            pil_image = bitmap.to_pil()
            buf = io.BytesIO()
            pil_image.save(buf, format="WEBP", quality=80)
            thumb_bytes = buf.getvalue()
            thumb_uploaded = storage.upload_bytes(thumb_bytes, thumb_key, "image/webp")
            if thumb_uploaded:
                await log_progress(db, gen_id, "saver", f"Uploaded thumbnail to: {thumb_key}")
        except Exception as thumb_err:
            await log_progress(db, gen_id, "saver", f"Thumbnail generation skipped: {thumb_err}")

    await log_progress(
        db, gen_id, "saver", "Generation pipeline successfully completed."
    )

    # Return only the keys for uploads that succeeded so the caller doesn't
    # persist a key pointing at a missing R2 object (broken presigned URLs).
    return {
        "pdf_storage_key": pdf_key if pdf_uploaded else None,
        "md_storage_key": md_key if md_uploaded else None,
        "thumb_storage_key": thumb_key if thumb_uploaded else None,
    }


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
        f"Repairing {len(orphans)} orphan/oversize bullet(s) (attempt {state.get('repair_attempts', 0) + 1})...",
    )

    experiences = state.get("experience_draft") or []
    projects = state.get("projects_draft") or []
    extracurriculars_draft = state.get("extracurriculars_draft") or []

    # Load repair history — tracks originals before any repair so we can revert.
    # Keys: "section:item_idx:bullet_idx" → original text before first repair.
    repair_history = dict(state.get("repair_history") or {})

    def clean_text(s):
        return re.sub(r"\*\*", "", s).strip()

    def history_key(section, item_idx, bullet_idx):
        return f"{section}:{item_idx}:{bullet_idx}"

    bullet_blocks = []
    mapping = []
    reverted = 0

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

        # Try to find in extracurriculars_draft (description field, not bullet_points)
        if not match:
            for ex_idx, ex in enumerate(extracurriculars_draft):
                desc = ex.get("description", "")
                if desc and clean_text(desc) == orphan_clean:
                    match = ("extracurriculars", ex_idx, 0, desc)
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
        hkey = history_key(section_key, item_idx, bullet_idx)

        # ── Rollback check: if this bullet was repaired before and is now >2 lines,
        #    revert to the pre-repair original instead of trying again.
        if hkey in repair_history and orphan.get("renderedLines", 0) > 2:
            pre_repair_text = repair_history[hkey]
            await log_progress(
                db,
                gen_id,
                "orphan_repair",
                f"Bullet '{orphan['text'][:40]}...' regressed to {orphan['renderedLines']} lines after repair. Reverting to original.",
                "warning",
            )
            if section_key == "experience":
                experiences[item_idx]["bullet_points"][bullet_idx] = pre_repair_text
            elif section_key == "projects":
                projects[item_idx]["bullet_points"][bullet_idx] = pre_repair_text
            elif section_key == "extracurriculars":
                extracurriculars_draft[item_idx]["description"] = pre_repair_text
            # Remove from history — original restored, no further repair needed.
            del repair_history[hkey]
            reverted += 1
            continue

        if section_key == "projects":
            context = f"Project: \"{projects[item_idx].get('name', '')}\""
        elif section_key == "experience":
            context = f"Experience: \"{experiences[item_idx].get('role', '')}\" at {experiences[item_idx].get('organization', '')}"
        else:
            context = "Extracurricular activity"

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
            "history_key": hkey,
            "target_max": target_max,
        })

    if reverted:
        await log_progress(
            db, gen_id, "orphan_repair",
            f"Reverted {reverted} bullet(s) to pre-repair originals due to >2 line regression.",
        )

    if not bullet_blocks:
        return {
            "experience_draft": experiences,
            "projects_draft": projects,
            "extracurriculars_draft": extracurriculars_draft,
            "orphans": None,
            "repair_attempts": state.get("repair_attempts", 0) + 1,
            "repair_history": repair_history,
        }

    try:
        kw_text = ", ".join(state["keywords"][:8]) if state["keywords"] else "N/A"
    except Exception:
        kw_text = "N/A"

    sys_prompt, usr_prompt = await get_prompt_config(
        db,
        "orphan_repair",
        default_system=(
            "ROLE: Precise resume line-wrap repair editor.\n"
            "TASK: Rewrite only specified bullets so rendered PDF line lengths fit constraints.\n"
            "OUTPUT CONTRACT: Return only one raw JSON object with key 'bullets'. No markdown fences, no prose, no comments.\n"
            "QUALITY BAR: Preserve meaning and truth while meeting character limits exactly."
        ),
        default_user=(
            "OUTPUT FORMAT - MANDATORY RAW JSON ONLY:\n"
            "{\n"
            '  "bullets": [\n'
            '    {"index": 1, "replacement": "Rewritten bullet text here."},\n'
            '    {"index": 2, "replacement": "..."}\n'
            "  ]\n"
            "}\n\n"
            "INPUT: Rendering Context\n"
            "Font: Computer Modern Serif (proportional). Each bullet has exact visible-character target range.\n\n"
            "RULES:\n"
            "- Return one replacement for every Bullet listed below, using same index values.\n"
            "- Character counts are visible characters only. Markdown bold markers (**) do not count.\n"
            "- Start every bullet with a strong action verb.\n"
            "- Bold all numbers, statistics, percentages, key technologies, and metrics, e.g. **35%**, **FastAPI**, **400ms**.\n"
            "- Expand by adding job-relevant supported technical detail; shorten by removing lower-value wording first.\n"
            "- Keep the core meaning and factual claims of the original.\n"
            "- Each replacement must stay within its target range and respect HARD MAX.\n"
            "- No emojis, no trailing explanations, no omitted bullets.\n\n"
            "INPUT: Job-Relevant Keywords\n{kw_text}\n\n"
            "INPUT: Bullets To Repair\n{bullet_blocks}\n\n"
            "Return only the raw JSON object."
        )
    )

    formatted_usr_prompt = _replace_prompt_vars(
        usr_prompt,
        {
            "kw_text": kw_text,
            "bullet_blocks": "\n\n".join(bullet_blocks),
        },
    )

    raw_response = ""
    try:
        from langchain_core.messages import SystemMessage, HumanMessage
        messages = [
            SystemMessage(content=sys_prompt),
            HumanMessage(content=formatted_usr_prompt)
        ]
        # invoke_with_fallback expects a chain_factory; for raw message invoke, wrap accordingly.
        resp = await invoke_with_fallback(
            lambda llm, p: llm,
            messages,
            timeout=40.0,
            node_name="orphan_repair",
            gen_id=gen_id,
            is_pro=state.get("is_pro", False),
        )
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
        return {
            "orphans": None,
            "repair_attempts": state.get("repair_attempts", 0) + 1,
            "repair_history": repair_history,
        }

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
            hkey = entry["history_key"]

            # Save original to repair_history BEFORE overwriting (only first time).
            if hkey not in repair_history:
                repair_history[hkey] = entry["original_md"]

            if section_key == "experience":
                experiences[item_idx]["bullet_points"][bullet_idx] = new_text
            elif section_key == "projects":
                projects[item_idx]["bullet_points"][bullet_idx] = new_text
            elif section_key == "extracurriculars":
                extracurriculars_draft[item_idx]["description"] = new_text
            
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
        "extracurriculars_draft": extracurriculars_draft,
        "orphans": None,
        "repair_attempts": state.get("repair_attempts", 0) + 1,
        "repair_history": repair_history,
    }

