import copy
import asyncio
import ast
import gc
import itertools
import json
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from jinja2 import Template
from langchain_core.prompts import ChatPromptTemplate
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import ValidationError
from langchain_core.exceptions import OutputParserException
from openai import APIError
import httpx

from src.core.config import settings  # noqa: F401 (kept for other settings usage)
from src.core.database import AsyncSessionLocal
from src.core.storage import StorageService
from src.models.generation import Generation, GenerationLog, GenerationNodeMetric, PromptConfig
from src.services.font_fit import find_best_font_size
from src.services.resume_render import (
    build_resume_markdown,
    check_horizontal_overflow,
    detect_orphans_in_weasyprint,
    ORPHAN_FILL_FLOOR,
    REPAIR_TARGET_LINES_MAX,
    REPAIR_TARGET_LINES_MIN,
)
from src.pipeline.state import ResumeGraphState
from src.core.skill_categories import merge_skill_categories, skill_category_display
from src.core.skill_enrichment import (
    build_candidate_evidence,
    collect_evidence_skills,
    enrich_skills,
    evidence_text,
)
from src.schemas.pipeline import (
    JobAnalysis,
    StrictSelectedItems,
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
    # Best-effort: a log write failure must not stop the generation.
    try:
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
    except Exception as log_exc:  # noqa: BLE001
        print(f"[log] Failed to persist log entry for {node_name}/{gen_id}: {log_exc}")


# ── LLM Init Helper ───────────────────────────────────────────────────────────

from src.services.llm_config import llm_config_service, InferenceExhausted, LLMNotConfigured  # noqa: F401 - re-exported




def _is_free_form_map(node: Any) -> bool:
    return isinstance(node, dict) and node.get("type") == "object" and "properties" not in node


def _strict_json_schema(schema) -> dict[str, Any]:
    """Wire contract for a Pydantic model that strict structured-output providers honour.

    Gemini omits optional properties (it dropped bullet_points and description), and OpenAI
    strict mode rejects objects without ``additionalProperties: false``. So every property is
    required (nullable fields stay nullable), every object is closed, and defaults are dropped.
    Optional free-form maps cannot be expressed in strict mode, so they are left out; Pydantic
    still fills their defaults when the response is validated against the real model.
    """
    contract = copy.deepcopy(schema.model_json_schema())

    def close(node: Any) -> None:
        if isinstance(node, list):
            for item in node:
                close(item)
            return
        if not isinstance(node, dict):
            return
        node.pop("default", None)
        properties = node.get("properties")
        if isinstance(properties, dict):
            required = set(node.get("required") or [])
            for name in [n for n, p in properties.items() if n not in required and _is_free_form_map(p)]:
                del properties[name]
            for child in properties.values():
                close(child)
            node["required"] = list(properties)
            node["additionalProperties"] = False
        for key in ("items", "anyOf", "allOf", "oneOf", "prefixItems", "additionalProperties"):
            close(node.get(key))
        for child in (node.get("$defs") or {}).values():
            close(child)

    close(contract)
    return contract


def _structured(llm, schema, provider: str | None = None):
    """Request JSON content and validate locally, without depending on tool calls."""
    from langchain_core.messages import SystemMessage
    from langchain_core.runnables import RunnableLambda

    mode = getattr(llm, "_structured_mode", "json_schema") or "json_schema"
    contract = _strict_json_schema(schema)

    async def invoke(value, config=None):
        messages = value.to_messages() if hasattr(value, "to_messages") else value
        if mode == "prompt_only":
            request = llm
        elif mode == "json_object":
            request = llm.bind(response_format={"type": "json_object"})
        else:
            request = llm.bind(response_format={"type": "json_schema", "json_schema": {
                "name": schema.__name__, "schema": contract}})
        raw = await request.ainvoke([SystemMessage(content=(
            "Return only one JSON object matching this schema. No markdown or commentary. "
            + json.dumps(contract))), *messages], config=config)
        parsed, error = None, None
        try:
            content = raw.content
            if isinstance(content, list):
                content = "".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
            # Accept a single fenced object, never extract JSON from arbitrary prose.
            content = re.sub(r"^```(?:json)?\s*\n?(.*?)\n?```$", r"\1", content.strip(), flags=re.S)
            parsed = schema.model_validate_json(content)
        except (ValidationError, ValueError, TypeError) as exc:
            error = type(exc).__name__
        return {"raw": raw, "parsed": parsed, "parsing_error": error}

    return RunnableLambda(invoke)

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
    """Canonical display name for a skill category (shared logic in core)."""
    return skill_category_display(category)


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
    # Merge on canonical keys (shared logic in core) so drifted variants like
    # "Programming & Backend" vs "Programming Backend" collapse into one.
    return merge_skill_categories(
        {category: _coerce_skill_items(items) for category, items in skills.items()}
    )


# ── Creativity mode helpers ───────────────────────────────────────────────────

VALID_CREATIVITY_MODES = ("proper", "larp", "super_larp")


def _creativity_mode(state: dict[str, Any]) -> str:
    mode = (state.get("creativity_mode") or "proper").lower().strip()
    return mode if mode in VALID_CREATIVITY_MODES else "proper"


def _prompt_name(base: str, mode: str) -> str:
    """Per-mode prompt config keys so Proper/LARP/Super-LARP evolve independently."""
    return f"{base}_{mode}" if mode in ("larp", "super_larp") else base


def _apply_professional_sans_skill_budget(skills: dict[str, list[str]]) -> dict[str, list[str]]:
    """Enforce professional-sans generation-only skill budget:
    max 4 categories, max 20 skills, and approximately 300/320 characters across all skill values.
    """
    capped_categories = list(skills.items())[:4]
    budgeted: dict[str, list[str]] = {}
    current_count = 0
    current_chars = 0

    for cat, items in capped_categories:
        cat_items = []
        for item in items:
            s = (item or "").strip()
            if not s:
                continue
            if len(s) > 320:
                s = s[:320].strip()
            if current_count >= 20:
                break
            if current_chars + len(s) > 320:
                if current_count == 0:
                    s = s[:320 - current_chars].strip()
                    if s:
                        cat_items.append(s)
                        current_count += 1
                        current_chars += len(s)
                break
            cat_items.append(s)
            current_count += 1
            current_chars += len(s)
        if cat_items:
            budgeted[cat] = cat_items
        if current_count >= 20 or current_chars >= 320:
            break

    return budgeted


def _ensure_jd_skill_coverage(
    skills: dict[str, list[str]],
    jd_skills: list[str],
    mode: str,
    template_id: str | None = None,
) -> dict[str, list[str]]:
    """In LARP modes guarantee JD skills appear in the skills section.

    Proper mode returns skills untouched (or budgeted if professional-sans).
    LARP/Super-LARP append any missing JD extracted_skills (case-insensitive)
    to the first non-soft category, creating one if needed.
    Caps injected skills to avoid unbounded stuffing.
    When template_id is 'professional-sans', respects the layout budget:
    at most 4 categories and roughly 20 skills/320 chars total.
    """
    if template_id == "professional-sans":
        skills = _apply_professional_sans_skill_budget(skills)

    if mode not in ("larp", "super_larp") or not jd_skills:
        return skills
    existing_lower = {s.lower() for items in skills.values() for s in items}
    missing = []
    for s in jd_skills:
        name = (s or "").strip()
        if name and name.lower() not in existing_lower:
            missing.append(name)
            existing_lower.add(name.lower())
    if not missing:
        return skills

    target_key = None
    for key in skills:
        if "soft" not in key.lower():
            target_key = key
            break
    if target_key is None:
        if template_id == "professional-sans" and len(skills) >= 4:
            target_key = next(iter(skills))
        else:
            target_key = next(iter(skills), "Tools & Technologies")
            skills.setdefault(target_key, [])

    if template_id == "professional-sans":
        for s in missing:
            s_clean = s.strip()
            if len(s_clean) > 320:
                s_clean = s_clean[:320].strip()
            current_count = sum(len(items) for items in skills.values())
            current_chars = sum(len(item) for items in skills.values() for item in items)
            if current_count >= 20 or current_chars + len(s_clean) > 320:
                break
            skills[target_key].append(s_clean)
    else:
        missing = missing[:15]
        skills[target_key] = [*skills.get(target_key, []), *missing]

    return skills


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
    try:
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
    except Exception as metric_exc:  # noqa: BLE001
        # Metric writes are best-effort. A DB failure here must not discard
        # a valid inference result or fail the resume generation.
        print(f"[metric] Failed to record node metric for {node_name}/{gen_id}: {metric_exc}")



class InvalidSelection(ValueError):
    pass

class InvalidStructuredOutput(ValueError):
    pass


def _validate_synthetic_project(project: TailoredProject) -> None:
    """Reject an incomplete replacement while keeping the provider schema stable."""
    if (
        not project.name.strip()
        or not project.description
        or not project.description.strip()
        or not project.technologies
        or any(not technology.strip() for technology in project.technologies)
        or not project.bullet_points
        or any(not bullet.strip() for bullet in project.bullet_points)
    ):
        raise InvalidStructuredOutput("Incomplete synthetic project")


def _actual_provider(llm: Any) -> str:
    return getattr(llm, "_endpoint_name", None) or "openai_compatible"


def _status_code(exc):
    seen = set()
    while exc is not None and id(exc) not in seen:
        seen.add(id(exc))
        code = getattr(exc, "status_code", None) or getattr(exc, "code", None)
        if isinstance(code, int):
            return code
        exc = exc.__cause__ or exc.__context__
    return None


def _finish_reason(reason):
    reason = getattr(reason, "name", reason)
    return str(reason or "").lower().split(".")[-1]


async def invoke_with_fallback(chain_factory, invoke_args, timeout: float | None = None, node_name: str | None = None,
                               gen_id: str | None = None, max_attempts_per_provider: int | None = None,
                               is_pro: bool = False, validate_result=None, role: str | None = None):
    """Try each configured role target in order, with bounded retries per target."""
    await llm_config_service.ensure_fresh()
    effective_role = role or ("pro" if is_pro else "default")
    targets = llm_config_service.resolve_targets(effective_role)
    if not targets:
        raise LLMNotConfigured(effective_role)

    for index, target in enumerate(targets):
        endpoint = target.endpoint
        name = endpoint.name
        attempts = endpoint.max_retries + 1
        if max_attempts_per_provider is not None:
            attempts = min(attempts, max_attempts_per_provider)
        attempts = max(1, attempts)
        deadline = timeout or endpoint.timeout_seconds
        for attempt in range(1, attempts + 1):
            try:
                llm = llm_config_service.build_client(target)
            except (ValueError, APIError, httpx.HTTPError) as exc:
                print(f"[llm_fallback] {endpoint.name} initialization failed ({type(exc).__name__}).")
                break
            name = _actual_provider(llm)
            chain = chain_factory(llm, endpoint.name)
            started = time.perf_counter()
            usage_result = None
            try:
                result = await asyncio.wait_for(chain.ainvoke(invoke_args), timeout=deadline)
                usage_result = result
                if isinstance(result, dict) and {"raw", "parsed", "parsing_error"} <= result.keys():
                    parsing_error = result["parsing_error"]
                    raw = result["raw"]
                    usage_result = raw
                    result = result["parsed"]
                    reason = (getattr(raw, "response_metadata", None) or {}).get("finish_reason")
                    reason = _finish_reason(reason)
                    if reason in ("length", "content_filter", "max_tokens", "safety") or result is None or parsing_error:
                        raise InvalidStructuredOutput(reason if reason in ("length", "content_filter", "max_tokens", "safety") else "parse_error")
                if result is None:
                    raise InvalidStructuredOutput("Structured output missing")
                if validate_result:
                    validate_result(result)
            except (TimeoutError, APIError, httpx.HTTPError, OutputParserException, ValidationError, InvalidSelection, InvalidStructuredOutput) as exc:
                status = _status_code(exc)
                if status in (401, 403, 429):
                    llm_config_service.mark_cooldown(endpoint.id)
                prompt_tokens, completion_tokens, total_tokens = _extract_token_usage(usage_result)
                await record_node_metric(
                    gen_id,
                    node_name,
                    name,
                    getattr(llm, "model_name", None) or getattr(llm, "model", None),
                    "error",
                    (time.perf_counter() - started) * 1000,
                    fallback_used=index > 0,
                    parse_error=isinstance(exc, (InvalidStructuredOutput, InvalidSelection, OutputParserException, ValidationError)) or _is_parse_error(exc),
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    total_tokens=total_tokens,
                    error_message=f"attempt {attempt}/{attempts}: {type(exc).__name__}" + (f" HTTP {status}" if status else "") + (f" ({exc})" if isinstance(exc, InvalidStructuredOutput) and str(exc) in ("length", "content_filter", "parse_error") else ""),
                )
                if status in (400, 401, 402, 403, 404, 422, 429, 500, 502, 503):
                    print(f"[llm_fallback] {name} returned {status}. Trying next target.")
                    break
                if attempt < attempts:
                    sleep_for = min(0.5 * (2 ** (attempt - 1)), 2.0)
                    print(f"[llm_retry] {name} attempt {attempt} failed ({type(exc).__name__}). Retrying in {sleep_for:.2f}s...")
                    await asyncio.sleep(sleep_for)

            else:
                prompt_tokens, completion_tokens, total_tokens = _extract_token_usage(usage_result)
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

        print(f"[llm_fallback] {name} exhausted attempts. Falling back to next target in chain...")
    raise InferenceExhausted("All LLM providers failed") from None

async def get_prompt_config(db: AsyncSession, name: str, default_system: str, default_user: str | None = None) -> tuple[str, str | None]:
    try:
        result = await db.execute(select(PromptConfig).where(PromptConfig.name == name))
        cfg = result.scalar_one_or_none()
        if cfg:
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


def _validate_selection(result, experience_count, project_count, max_exp, max_proj):
    for indices, available, requested, label in (
        (result.selected_experience_indices, experience_count, max_exp, "experience"),
        (result.selected_project_indices, project_count, max_proj, "project"),
    ):
        expected_count = min(available, requested)
        if len(indices) != expected_count:
            raise InvalidSelection(
                f"wrong_count: expected {expected_count} {label} indices, got {len(indices)}"
            )
        if len(set(indices)) != len(indices):
            raise InvalidSelection(f"duplicate_index in {label} indices")
        for i in indices:
            if type(i) is not int:
                raise InvalidSelection(f"non_int: {type(i).__name__!r} in {label} indices")
            if i < 0 or i >= available:
                raise InvalidSelection(f"out_of_bounds: {label} index {i} (available={available})")


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

    def validate_selection(result):
        _validate_selection(result, len(experiences), len(projects), max_exp, max_proj)

    result = await invoke_with_fallback(
            lambda llm, p: prompt | _structured(llm, StrictSelectedItems, p),
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
            validate_result=validate_selection,
        )
    selected_experiences = [experiences[i] for i in result.selected_experience_indices]
    selected_projects = [projects[i] for i in result.selected_project_indices]
    candidate_evidence = build_candidate_evidence((state.get("profile") or {}).get("skills"), projects, experiences)

    await log_progress(
        db,
        gen_id,
        "selection",
        f"Selected {len(selected_experiences)}/{max_exp} experience(s) and {len(selected_projects)}/{max_proj} project(s) " + "based on relevance.",
    )

    return {
        "experiences": selected_experiences,
        "projects": selected_projects,
        "candidate_evidence": candidate_evidence,
    }


PROFESSIONAL_SANS_POLICY_VERSION = "v1"


def _professional_sans_policy(state_or_id: Any, section: str) -> str:
    """Apply the measured layout budget after stored prompts are loaded."""
    template_id = None
    mode = "proper"
    if isinstance(state_or_id, str):
        template_id = state_or_id
    elif isinstance(state_or_id, dict):
        manifest = state_or_id.get("template_manifest")
        if isinstance(manifest, dict) and manifest.get("id"):
            template_id = manifest.get("id")
        elif hasattr(manifest, "id"):
            template_id = manifest.id
        elif state_or_id.get("template_id"):
            template_id = state_or_id.get("template_id")
        mode = state_or_id.get("creativity_mode") or "proper"

    if template_id != "professional-sans":
        return ""

    is_larp = mode in ("larp", "super_larp")

    if is_larp:
        budgets = {
            "summary": (
                "Keep the summary to at most 30 words. Organize skills into at most 4 categories "
                "with roughly 20 concise skills total (approximately 300 characters across all skill values); "
                "prioritize job-relevant skills."
            ),
            "experience": (
                "Write exactly two distinct achievement bullets per entry (at most two bullets). "
                "Aim for 18–23 words and at most 185 characters per bullet. Use restrained bold emphasis only on key metrics/technologies. "
                "Overrides conflicting bullet counts (do not write 3 bullets), line-fill, or bolding instructions above. "
                "Preserves active LARP/Super-LARP mode rules above without restricting embellishment."
            ),
            "project": (
                "Write exactly two distinct achievement bullets per entry (at most two bullets). "
                "Aim for 18–23 words and at most 185 characters per bullet. Keep project summaries under 35 characters. Use restrained bold emphasis "
                "only on key metrics/technologies. Overrides conflicting bullet counts (do not write 3 bullets), "
                "line-fill, or bolding instructions above. Preserves active LARP/Super-LARP mode rules above without restricting embellishment."
            ),
            "synthetic_project": (
                "Write exactly two distinct achievement bullets per entry (at most two bullets). Aim for 18–23 words "
                "and at most 185 characters per bullet. Keep project summaries under 35 characters. Use restrained bold emphasis "
                "only on key metrics/technologies. Overrides conflicting bullet counts (do not write 3 bullets), "
                "line-fill, or bolding instructions above."
            ),
            "orphan_repair": (
                "Render target is Arial A4 layout with 1.4 line-height. Aim for 18–23 words and at most 185 characters "
                "per bullet. Keep each repaired bullet within exactly 2 lines maximum without creating short orphan "
                "lines; never exceed 185 characters. Use restrained bold emphasis rather than bolding every entity. "
                "Overrides conflicting font, line-fill, or bolding instructions above. "
                "Preserves active LARP/Super-LARP mode rules above without restricting embellishment."
            ),
            "extracurricular": (
                "Provide at most one concise extracurricular entry. Keep each description to approximately "
                "20 words or fewer."
            ),
        }
    else:
        budgets = {
            "summary": (
                "Keep the summary to at most 30 words. Organize skills into at most 4 categories "
                "with roughly 20 concise skills total (approximately 300 characters across all skill values); "
                "prioritize job-relevant skills without inventing keywords."
            ),
            "experience": (
                "Write exactly two distinct supported achievement bullets per entry when evidence is available "
                "(or fewer if evidence is limited, at most two bullets; never invent or pad). Aim for 18–23 words "
                "and at most 185 characters per bullet. Use restrained bold emphasis only on key metrics/technologies. "
                "Overrides conflicting bullet counts (do not write 3 bullets), line-fill, or bolding instructions above."
            ),
            "project": (
                "Write exactly two distinct supported achievement bullets per entry when evidence is available "
                "(or fewer if evidence is limited, at most two bullets; never invent or pad). Aim for 18–23 words "
                "and at most 185 characters per bullet. Keep project summaries under 35 characters. Use restrained bold emphasis "
                "only on key metrics/technologies. Overrides conflicting bullet counts (do not write 3 bullets), "
                "line-fill, or bolding instructions above."
            ),
            "synthetic_project": (
                "Write exactly two distinct supported achievement bullets per entry when evidence is available "
                "(or fewer if evidence is limited, at most two bullets; never invent or pad). Aim for 18–23 words "
                "and at most 185 characters per bullet. Keep project summaries under 35 characters. Use restrained bold emphasis "
                "only on key metrics/technologies. Overrides conflicting bullet counts (do not write 3 bullets), "
                "line-fill, or bolding instructions above."
            ),
            "orphan_repair": (
                "Render target is Arial A4 layout with 1.4 line-height. Aim for 18–23 words and at most 185 characters "
                "per bullet. Keep each repaired bullet within exactly 2 lines maximum without creating short orphan "
                "lines; never exceed 185 characters. Use restrained bold emphasis rather than bolding every entity. "
                "Never invent facts or drop factual claims. Overrides conflicting font, line-fill, or bolding instructions above."
            ),
            "extracurricular": (
                "Provide at most one concise supported extracurricular entry. Keep each description to approximately "
                "20 words or fewer without losing important facts; never invent or pad."
            ),
        }

    instruction = budgets.get(section, "")
    if not instruction:
        return ""
    prefix = chr(10) + chr(10) + f"PROFESSIONAL SANS LAYOUT POLICY {PROFESSIONAL_SANS_POLICY_VERSION} (overrides conflicting length, bullet count, line-fit, and bolding instructions above): "
    return prefix + instruction


async def summary_skills_node(
    state: ResumeGraphState, db: AsyncSession, gen_id: str
) -> dict[str, Any]:
    await log_progress(
        db,
        gen_id,
        "summary_skills",
        "Generating tailored summary & categorizing skills...",
    )

    mode = _creativity_mode(state)
    skills_fill = (
        "- Fill every category: at least 3 skills per category (Soft Skills 3-4) and 15-22 skills in total, so the section never looks sparse.\n"
        "- Build skills from ALL candidate evidence: profile skills, technologies used in the candidate's projects, and tools named in their experience. "
        "Put the job's required skills first within each category.\n"
    )
    if mode == "proper":
        skills_rule = (
            "- categories: 4-6 skill categories total (e.g. Languages, Frontend, Backend, Databases, AI & ML, Tools, Soft Skills). Must include a 'Soft Skills' category with items grounded in the experience (mentoring, collaboration, ownership).\n"
            "- Each category must have a category name and a list of short skill names.\n"
            f"{skills_fill}"
            "- Use ONLY skills evidenced in candidate material; never invent a tool the candidate has no basis for."
        )
        summary_rule = "- Anchor summary in candidate evidence and job priorities; do not claim unsupported years, degrees, employers, or certifications."
    else:
        skills_rule = (
            "- categories: 4-6 skill categories total (e.g. Languages, Frontend, Backend, Databases, AI & ML, Tools, Soft Skills). Must include a 'Soft Skills' category.\n"
            "- Each category must have a category name and a list of short skill names.\n"
            "- START from the job's extracted skills and make coverage the priority: every important job skill MUST appear somewhere, even if absent from the candidate profile.\n"
            f"{skills_fill}"
            "- Vary wording/order per job so outputs do not look identical."
        )
        summary_rule = (
            "- Write a vivid, varied summary anchored in job priorities; mirror the job's language and foreground its top 2-3 requirements. "
            "You may imply familiarity with job-required tools even when candidate evidence is thin."
        )
    sys_prompt, usr_prompt = await get_prompt_config(
        db,
        _prompt_name("summary_skills", mode),
        default_system=(
            "ROLE: Senior resume writer optimizing top-of-resume positioning for ATS and human reviewers.\n"
            "TASK: Write a concise targeted summary and categorized skills from candidate material and job analysis.\n"
            "OUTPUT CONTRACT: Return only the structured TailoredSummaryAndSkills object with summary and categories.\n"
            "RULES:\n"
            "- summary: exactly 1-2 sentences, maximum 30 words, no first person, no fluff.\n"
            f"{summary_rule}\n"
            f"{skills_rule}\n"
            "- No prose outside the structured output."
        ),
        default_user=(
            "INPUT: Job Analysis\n{job_analysis}\n\n"
            "INPUT: Candidate Skills\n{candidate_skills}\n\n"
            "INPUT: Candidate Existing Summary\n{candidate_summary}"
        )
    )
    sys_prompt += _professional_sans_policy(state, "summary")
    prompt = ChatPromptTemplate.from_messages([("system", sys_prompt), ("user", usr_prompt)])

    evidence = state.get("candidate_evidence") or build_candidate_evidence(
        state["profile"].get("skills"), state.get("projects") or [], state.get("experiences") or []
    )
    profile_skills = ", ".join(state["profile"].get("skills") or [])
    # The stored prompt rows only carry {candidate_skills}, so the evidence digest rides along in it.
    candidate_skills = (profile_skills + "\n\nCandidate evidence (projects and experience):\n" + evidence_text(evidence)) if evidence_text(evidence) else profile_skills
    result = await invoke_with_fallback(
        lambda llm, p: prompt | _structured(llm, TailoredSummaryAndSkills, p),
        {
            "job_analysis": str(state["job_analysis"]),
            "candidate_skills": candidate_skills,
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
    jd_skills = (state.get("job_analysis") or {}).get("extracted_skills") or []
    tmpl_id = (state.get("template_manifest") or {}).get("id") or state.get("template_id")
    manifest = state.get("template_manifest") or {}
    compact = tmpl_id == "professional-sans"
    job_analysis = state.get("job_analysis") or {}
    job_terms = [*jd_skills, *(job_analysis.get("key_requirements") or []), *(state.get("keywords") or [])]
    before = sum(len(v) for v in summary_draft["skills"].values())
    summary_draft["skills"] = enrich_skills(
        summary_draft["skills"],
        collect_evidence_skills(evidence, [p.get("name", "") for p in state.get("projects") or []]),
        job_terms,
        floor_total=14 if compact else 16,
        max_total=20 if compact else 24,
        max_categories=manifest.get("max_skills_categories") or 6,
    )
    after = sum(len(v) for v in summary_draft["skills"].values())
    if after > before:
        await log_progress(
            db, gen_id, "summary_skills",
            f"Skills: added {after - before} skill(s) from your projects and experience ({before} -> {after} across {len(summary_draft['skills'])} categories).",
        )
    if tmpl_id == "professional-sans":
        summary_draft["skills"] = _apply_professional_sans_skill_budget(summary_draft["skills"])
    summary_draft["skills"] = _ensure_jd_skill_coverage(summary_draft["skills"], jd_skills, mode, template_id=tmpl_id)
    return {"summary_draft": summary_draft}


# ── Writer prompts: metric-dense bullets ──────────────────────────────────────
# One source for the code defaults and the stored prompt_configs rows (stored rows
# override these defaults). No literal braces: the system prompt is .format()-ed.

_BULLET_STYLE_RULES = (
    "- Bold each number together with its unit as one short span, and each named tool, framework, language, or model. "
    "Never bold generic fields (Machine Learning, AI, Data Analytics) or spans longer than 4 words.\n"
    "- Line-fit: write each bullet to fill about 1.8-1.9 rendered lines (two nearly full lines), about 175-200 visible characters. "
    "HARD LIMIT 205 characters: a bullet over 205 wraps onto a third line and is cut, so stay clearly under it and cut a clause "
    "rather than run over. Never leave a short second line.\n"
    "- ATS-readable: standard tool names, digits for numbers, no emojis or arrows. No periods required.\n"
)

_LARP_METRIC_RULES = (
    "- Bullet formula: action verb + what was built + bold tools + how + bold measured result.\n"
    "- Every bullet: at least 2 bold metrics and at least 2 bold technologies.\n"
    "- Metrics are outcomes or scale in varied units: % change, ms/s latency, x speedup, K/M records or requests, QPS, $ cost, "
    "GB, accuracy/F1/AUC, hours saved. First place every number listed under Source metrics into that entry's bullets, exactly as "
    "given; only then invent further metrics, which must look measured, not round (avoid 30%, 50%, 10x). "
    "Never use headcounts (team size, reviewers, attendees) as a metric. Never repeat a number in your output.\n"
)

_PROPER_METRIC_RULES = (
    "- Bullet formula: action verb + what was built + bold tools + how + result (bold and measured when the input states a number).\n"
    "- Every bullet: at least 2 bold technologies supported by the input (1 if the entry names only one).\n"
    "- Quantify only with numbers stated in that entry's input (listed under Source metrics); keep each one exact and bold, "
    "and lead with it. If an entry has none, show concrete scope (named systems, data sources, tools) instead of vague adjectives.\n"
)

_METRIC_TOKEN = re.compile(
    r"(?<![A-Za-z0-9.])(?!(?:19|20)\d\d\b)[$<>~]?\d[\d,.]*\s?(?:%|x|ms|s|[kKMB]|\+)?(?![A-Za-z])"
)
_BOLD_SPAN = re.compile(r"\*\*(.+?)\*\*")


def _source_metrics(texts: list[str]) -> list[str]:
    """Distinct numbers stated in the source text, in order (years and version-like tokens excluded)."""
    found: list[str] = []
    for text in texts:
        for match in _METRIC_TOKEN.finditer(text or ""):
            token = match.group(0).strip(" .,")
            if token and token not in found:
                found.append(token)
    return found[:12]


def _source_metrics_line(*texts: Any) -> str:
    flat: list[str] = []
    for item in texts:
        if isinstance(item, (list, tuple)):
            flat.extend(str(x) for x in item if x)
        elif item:
            flat.append(str(item))
    metrics = _source_metrics(flat)
    return f"Source metrics: {', '.join(metrics) if metrics else 'none'}\n"


def _is_metric_span(span: str) -> bool:
    span = span.strip()
    return bool(
        re.match(r"^[<>~$+\-]?\s?\d", span)
        or re.search(r"\d\s?(?:%|x\b|ms\b|s\b|[KMB]\b|\+)", span)
    )


def bullet_density(text: str) -> tuple[int, int]:
    """(bold metric spans, bold technology spans) in a bullet."""
    spans = _BOLD_SPAN.findall(text or "")
    metrics = sum(1 for s in spans if _is_metric_span(s))
    return metrics, len(spans) - metrics


def _density_summary(bullets: list[str]) -> str:
    dense = sum(1 for b in bullets if (lambda m, t: m >= 2 and t >= 2)(*bullet_density(b)))
    with_metric = sum(1 for b in bullets if bullet_density(b)[0] >= 1)
    return (
        f"Density: {dense}/{len(bullets)} bullets have >=2 bold metrics and >=2 bold tools; "
        f"{with_metric}/{len(bullets)} have a metric."
    )


def experience_writer_default_prompts(mode: str) -> tuple[str, str]:
    if mode == "proper":
        truth_rule = "- Do not invent employers, products, metrics, users, revenue, or credentials. You may reframe existing evidence.\n"
        variety_rule = "- Emphasize job-relevant technologies, scope, outcomes, collaboration, ownership, and measurable impact.\n"
        metric_rules = _PROPER_METRIC_RULES
    else:
        truth_rule = (
            "- LARP MODE: you may embellish freely within the existing role/company. Add job-required features, tools, and "
            "plausible metrics/scale the candidate did not state, as long as role, organization, and dates stay intact. "
            "Never create a new employer or role, but do not be afraid to claim the job's stack.\n"
        )
        variety_rule = (
            "- Each bullet proves a different JD requirement through a technical result; fold documentation, collaboration, "
            "or communication requirements into a technical bullet, never a standalone one. Vary verbs and sentence shapes. "
            "Foreground exact JD keywords and technologies.\n"
        )
        metric_rules = _LARP_METRIC_RULES
    system = (
        "ROLE: Senior technical resume writer.\n"
        "TASK: Rewrite selected experience entries to prove fit for the target job while preserving truth.\n"
        "OUTPUT CONTRACT: Return only the structured TailoredExperienceBatch object with entries. "
        "Return EXACTLY {batch_len} entries in input order.\n"
        "RULES:\n"
        "- Preserve role, organization, dates, and location unless input is missing.\n"
        "- Each entry must contain 2-3 bullet_points (hard limit: never more than 3), limited by available source material.\n"
        "- Start every bullet with a strong past-tense action verb.\n"
        + variety_rule + truth_rule + metric_rules + _BULLET_STYLE_RULES +
        "- No prose outside the structured output."
    )
    user = "INPUT: Job Analysis\n{job_analysis}\n\nINPUT: Experience Entries To Rewrite\n{entries}"
    return system, user


def projects_writer_default_prompts(mode: str) -> tuple[str, str]:
    if mode == "proper":
        tech_rule = "- technologies: normalized list of technologies from input plus clearly supported technologies only.\n"
        depth_rule = "- Emphasize architecture, implementation depth, job-relevant tools, measurable performance, users, scale, or impact when supported.\n"
        invent_rule = "- Do not invent metrics, deployments, users, awards, or technologies not supported by input.\n"
        metric_rules = _PROPER_METRIC_RULES
    else:
        tech_rule = "- technologies: normalized list that MUST foreground the job's required stack; add missing JD technologies even if absent from input.\n"
        depth_rule = "- Emphasize architecture and implementation depth; vary phrasing per job so outputs do not look templated.\n"
        invent_rule = (
            "- LARP MODE: you may add plausible JD-aligned features, integrations, and metrics to the existing project "
            "(e.g. claim the missing feature because it fits the job). Never invent a wholly new project here — "
            "that is reserved for Super LARP slot 1 — but do not be afraid to stretch details.\n"
        )
        metric_rules = _LARP_METRIC_RULES
    system = (
        "ROLE: Senior technical resume writer specializing in project sections.\n"
        "TASK: Rewrite selected project entries so they map clearly to target job requirements.\n"
        "OUTPUT CONTRACT: Return only the structured TailoredProjectBatch object with entries. "
        "Return EXACTLY {batch_len} entries in input order.\n"
        "RULES:\n"
        "- Preserve project name unless spelling cleanup is needed.\n"
        "- project_summary: 2-4 words describing the project category, e.g. 'API Automation Platform'.\n"
        "- description: one concise sentence explaining what the project does and why it matters.\n"
        + tech_rule +
        "- bullet_points: 2-3 achievement bullets (hard limit: never more than 3), each starting with a strong action verb.\n"
        + depth_rule + invent_rule + metric_rules + _BULLET_STYLE_RULES +
        "- No prose outside the structured output."
    )
    user = "INPUT: Job Analysis\n{job_analysis}\n\nINPUT: Project Entries To Rewrite\n{entries}"
    return system, user


def synthetic_project_default_prompts() -> tuple[str, str]:
    system = (
        "ROLE: Senior engineer inventing a single hyper-relevant portfolio project for a resume.\n"
        "TASK: Invent ONE project that mirrors the target job description as closely as possible.\n"
        "OUTPUT CONTRACT: Return only the structured TailoredProject object.\n"
        "RULES:\n"
        "- Name: realistic, specific, not a copy of the job title (e.g. 'Realtime Fraud Scoring API').\n"
        "- project_summary: 2-4 words, e.g. 'ML Scoring Service'.\n"
        "- description: one sentence on what it does and why it matters for this job.\n"
        "- technologies: the job's core stack (normalize names), 4-8 items.\n"
        "- bullet_points: 2-3 achievement bullets (hard limit: never more than 3) starting with strong action verbs, "
        "each embedding JD keywords and plausible architecture.\n"
        + _LARP_METRIC_RULES + _BULLET_STYLE_RULES +
        "- Keep it believable as a personal project; no employer claims, no awards.\n"
        "- No prose outside the structured output."
    )
    user = "INPUT: Job Analysis\n{job_analysis}\n\nInvent the single most job-aligned project for this role."
    return system, user


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
    max_bullets = state["template_manifest"].get("max_bullets_per_experience", 3)
    job_analysis = str(state["job_analysis"])
    batch = experiences[:max_exp]

    entries_text = ""
    for i, exp in enumerate(batch, start=1):
        entries_text += (
            f"\n--- Entry {i} ---\n"
            f"Role: {exp['role']}\nCompany: {exp['organization']}\n"
            f"Bullet Points:\n" + "\n".join(exp.get("bullet_points") or []) + "\n"
            + _source_metrics_line(exp.get("bullet_points"))
        )

    mode = _creativity_mode(state)
    default_system, default_user = experience_writer_default_prompts(mode)
    sys_prompt, usr_prompt = await get_prompt_config(
        db,
        _prompt_name("experience_writer", mode),
        default_system=default_system,
        default_user=default_user,
    )
    sys_prompt += _professional_sans_policy(state, "experience")
    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", sys_prompt.format(batch_len=len(batch))),
            ("user", usr_prompt),
        ]
    )

    def _validate_exp_batch(res: Any):
        entries = getattr(res, "entries", None)
        if not entries or len(entries) < len(batch):
            raise InvalidStructuredOutput(
                f"Expected at least {len(batch)} experience entries in batch response, got {len(entries) if entries else 0}"
            )
        for i, original in enumerate(batch):
            orig_bullets = [str(b).strip() for b in original.get("bullet_points") or [] if b and str(b).strip()]
            has_evidence = bool(orig_bullets) or bool((original.get("description") or "").strip())
            if has_evidence and i < len(entries):
                raw_retained = getattr(entries[i], "bullet_points", [])[:max_bullets]
                retained_bullets = [str(b).strip() for b in raw_retained]
                if not retained_bullets or any(not b for b in retained_bullets):
                    raise InvalidStructuredOutput(
                        f"Experience entry {i + 1} ('{original.get('role', '')}') has empty/blank retained bullets despite source having evidence."
                    )

    await log_progress(db, gen_id, "experience_writer", f"Tailoring {len(batch)} experience entries in one batch...")
    try:
        result = await invoke_with_fallback(
            lambda llm, p: prompt | _structured(llm, TailoredExperienceBatch, p),
            {"job_analysis": job_analysis, "entries": entries_text},
            node_name="experience_writer",
            gen_id=gen_id,
            is_pro=state.get("is_pro", False),
            validate_result=_validate_exp_batch,
        )
    except InferenceExhausted:
        await log_progress(
            db,
            gen_id,
            "experience_writer",
            "Experience tailoring exhausted; falling back to original experience entries with all source bullets preserved.",
            "warning",
        )
        return {
            "experience_draft": copy.deepcopy(batch),
            "experience_fallback": True,
        }

    tailored_exps = []
    for i, original in enumerate(batch):
        if i < len(result.entries):
            tailored = result.entries[i]
            clean_retained = [str(b).strip() for b in tailored.bullet_points[:max_bullets] if b and str(b).strip()]
            tailored_exps.append({
                "role": original.get("role") or tailored.role,
                "organization": original.get("organization") or tailored.organization,
                "location": original.get("location") or tailored.location,
                "start_date": original.get("start_date"),
                "end_date": original.get("end_date"),
                "bullet_points": clean_retained,
            })
        else:
            tailored_exps.append(copy.deepcopy(original))

    await log_progress(db, gen_id, "experience_writer", "Finished tailoring all experience entries.")
    await log_progress(
        db, gen_id, "experience_writer",
        _density_summary([b for e in tailored_exps for b in e.get("bullet_points") or []]),
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
            + _source_metrics_line(proj.get("description"), proj.get("bullet_points"))
        )

    mode = _creativity_mode(state)
    default_system, default_user = projects_writer_default_prompts(mode)
    sys_prompt, usr_prompt = await get_prompt_config(
        db,
        _prompt_name("projects_writer", mode),
        default_system=default_system,
        default_user=default_user,
    )
    sys_prompt += _professional_sans_policy(state, "project")
    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", sys_prompt.format(batch_len=len(batch))),
            ("user", usr_prompt),
        ]
    )

    def _validate_proj_batch(res: Any):
        entries = getattr(res, "entries", None)
        if not entries or len(entries) < len(batch):
            raise InvalidStructuredOutput(
                f"Expected at least {len(batch)} project entries in batch response, got {len(entries) if entries else 0}"
            )
        for i, original in enumerate(batch):
            orig_bullets = [str(b).strip() for b in original.get("bullet_points") or [] if b and str(b).strip()]
            has_evidence = bool(orig_bullets) or bool((original.get("description") or "").strip())
            if has_evidence and i < len(entries):
                raw_retained = getattr(entries[i], "bullet_points", [])[:max_bullets]
                retained_bullets = [str(b).strip() for b in raw_retained]
                if not retained_bullets or any(not b for b in retained_bullets):
                    raise InvalidStructuredOutput(
                        f"Project entry {i + 1} ('{original.get('name', '')}') has empty/blank retained bullets despite source having evidence."
                    )

    try:
        result = await invoke_with_fallback(
            lambda llm, p: prompt | _structured(llm, TailoredProjectBatch, p),
            {"job_analysis": job_analysis, "entries": entries_text},
            node_name="projects_writer",
            gen_id=gen_id,
            is_pro=state.get("is_pro", False),
            validate_result=_validate_proj_batch,
        )
    except InferenceExhausted:
        await log_progress(
            db,
            gen_id,
            "projects_writer",
            "Project tailoring exhausted; falling back to original project entries with all source bullets preserved.",
            "warning",
        )
        return {
            "projects_draft": copy.deepcopy(batch),
            "projects_fallback": True,
        }

    tailored_projs = []
    for i, original in enumerate(batch):
        if i < len(result.entries):
            tailored = result.entries[i]
            clean_retained = [str(b).strip() for b in tailored.bullet_points[:max_bullets] if b and str(b).strip()]
            tailored_projs.append({
                "name": original.get("name") or tailored.name,
                "project_summary": tailored.project_summary or original.get("project_summary"),
                "description": tailored.description or original.get("description"),
                "technologies": tailored.technologies or original.get("technologies", []),
                "bullet_points": clean_retained,
                "github_url": original.get("github_url"),
                "live_url": original.get("live_url"),
                "start_date": original.get("start_date"),
                "end_date": original.get("end_date"),
            })
        else:
            tailored_projs.append(copy.deepcopy(original))

    await log_progress(db, gen_id, "projects_writer", "Finished tailoring all project entries.")
    await log_progress(
        db, gen_id, "projects_writer",
        _density_summary([b for p in tailored_projs for b in p.get("bullet_points") or []]),
    )
    if mode == "super_larp" and tailored_projs:
        await log_progress(
            db, gen_id, "projects_writer",
            "Super LARP: replacing first project with JD-hyper-focused synthetic project...",
        )
        try:
            synth_default_system, synth_default_user = synthetic_project_default_prompts()
            synth_sys, _ = await get_prompt_config(
                db,
                "synthetic_project_super_larp",
                default_system=synth_default_system,
                default_user=synth_default_user,
            )
            synth_sys += _professional_sans_policy(state, "synthetic_project")
            synth_prompt = ChatPromptTemplate.from_messages(
                [("system", synth_sys), ("user", "INPUT: Job Analysis\n{job_analysis}")]
            )
            synth = await invoke_with_fallback(
                lambda llm, p: synth_prompt | _structured(llm, TailoredProject, p),
                {"job_analysis": job_analysis},
                node_name="projects_writer",
                gen_id=gen_id,
                is_pro=state.get("is_pro", False),
                validate_result=_validate_synthetic_project,
            )
            tailored_projs[0] = {
                "name": synth.name,
                "project_summary": synth.project_summary,
                "description": synth.description,
                "technologies": synth.technologies,
                "bullet_points": synth.bullet_points[:max_bullets],
                "github_url": None,
                "live_url": None,
                "start_date": None,
                "end_date": None,
            }
            await log_progress(
                db, gen_id, "projects_writer",
                f"Super LARP: synthetic project '{synth.name}' installed in slot 1.",
            )
        except Exception as exc:
            await log_progress(
                db, gen_id, "projects_writer",
                f"Super LARP synthetic project failed, keeping tailored projects: {exc}",
                "warning",
            )
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

    tmpl_id = (state.get("template_manifest") or {}).get("id") or state.get("template_id")
    batch = valid_entries[:1] if tmpl_id == "professional-sans" else valid_entries[:3]
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
    sys_prompt += _professional_sans_policy(state, "extracurricular")
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
    max_extra = 1 if tmpl_id == "professional-sans" else 3
    tailored = [
        {"description": entry.description}
        for entry in result.entries[:max_extra]
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

    # Hard bullet cap: never more than 3 per entry, regardless of LLM output
    # or stale DB prompt configs. Prevents 2-page overflow.
    manifest = state.get("template_manifest") or {}
    max_exp_bullets = manifest.get("max_bullets_per_experience", 3)
    max_proj_bullets = manifest.get("max_bullets_per_project", 3)
    exp_fallback = bool(state.get("experience_fallback"))
    proj_fallback = bool(state.get("projects_fallback"))
    for exp in experiences:
        is_fb = exp_fallback or bool(exp.get("_is_fallback"))
        if not is_fb and isinstance(exp.get("bullet_points"), list):
            exp["bullet_points"] = exp["bullet_points"][:max_exp_bullets]
    for proj in projects:
        is_fb = proj_fallback or bool(proj.get("_is_fallback"))
        if not is_fb and isinstance(proj.get("bullet_points"), list):
            proj["bullet_points"] = proj["bullet_points"][:max_proj_bullets]

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

    manifest = state.get("template_manifest") or {}
    max_skills_cat = manifest.get("max_skills_categories")
    skills_assembled = _normalize_skills(summary_draft.get("skills"))
    if max_skills_cat and len(skills_assembled) > max_skills_cat:
        skills_assembled = {k: v for k, v in list(skills_assembled.items())[:max_skills_cat]}
    if manifest.get("id") == "professional-sans":
        total_items = sum(len(v) for v in skills_assembled.values())
        if total_items > 22:
            capped_skills: dict[str, list[str]] = {}
            for cat, items in skills_assembled.items():
                capped_skills[cat] = items[:max(1, 20 // len(skills_assembled))]
            skills_assembled = capped_skills

    tailored_resume = {
        "summary": summary_draft.get("summary"),
        "skills": skills_assembled,
        "experiences": experiences,
        "projects": projects,
        "education": education,
        "extracurriculars": extracurriculars,
    }

    await log_progress(db, gen_id, "assembly", "Resume assembly complete.")
    return {"tailored_resume": tailored_resume}



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
        "section_order": state.get("section_order"),
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
        margin_mm = float(template_manifest.get("page_margin_mm", 15.0))
        has_h_overflow = check_horizontal_overflow(doc, margin_mm)
        if pages <= target_pages and not has_h_overflow:
            # Fits — replace cached doc; old doc freed by reference drop
            _last_fit_doc[0] = doc
        else:
            # Overflow — discard immediately
            del doc
        return pages, has_h_overflow

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
        section_order=state.get("section_order"),
    )
    return {
        "pdf_bytes": best_pdf_bytes,
        "markdown": md_content,
        "page_count": best_page_count,
        "font_size": best_font_size,
        "orphans": orphans if orphans else None,
        "fits_target": fit_result.fits_target,
        "has_horizontal_overflow": fit_result.has_horizontal_overflow,
    }


# ── Layout guard: no bullet may be saved on 3+ lines ──────────────────────────
# The LLM repair is probabilistic. This last step is deterministic: whatever the
# final render still shows on 3+ lines is trimmed (lowest-value clauses first, never
# a bold metric before plain filler), re-rendered at the final font size, and
# verified. A 3-line bullet cannot reach the saved PDF.

FINAL_TRIM_MAX_ITER = 6

# Clause boundaries only where a clause can stand or fall on its own: after ; or :, after a comma that
# introduces a gerund clause (", cutting ..."), or before a participial connector. Never inside a
# comma-separated list of tools, and never before a preposition (by, to, for, across): that would split
# a verb from its metric ("cutting latency | by 30%") or break a list, leaving a dangling fragment.
_CLAUSE_BREAK = re.compile(
    r"(?<=[;:])\s+"
    r"|(?<=,)\s+(?=\w+ing\b)"
    r"|\s+(?=(?:with|using|while|enabling|ensuring|allowing|leveraging|via|plus|yielding|achieving|"
    r"delivering|saving|resulting|driving|improving)\b)",
    re.I,
)
_DANGLING_TAIL = re.compile(
    r"[\s,;:\-–—]*(?:\b(?:and|or|with|using|while|to|for|by|via|in|on|of|the|a|an|plus|so|that|which|across|through|"
    r"enabling|ensuring|allowing|leveraging)\b[\s,;:]*)+$",
    re.I,
)


def _tidy_trimmed(text: str) -> str:
    if text.count("**") % 2:
        cut = text.rfind("**")
        text = text[:cut] + text[cut + 2:]
    return _DANGLING_TAIL.sub("", text).rstrip(" ,;:-–—")


# Tail cuts may happen at any preposition or connector: removing everything after such a word always
# leaves a grammatical prefix ("... by 30% across X" -> "... by 30%").
_TAIL_BREAK = re.compile(
    r"(?<=[;:])\s+"
    r"|(?<=,)\s+(?=\w+ing\b)"
    r"|\s+(?=(?:with|using|while|enabling|ensuring|allowing|leveraging|via|plus|yielding|achieving|"
    r"delivering|saving|resulting|driving|improving|across|for|to|by|at|in|on|and|or|through|into|from)\b)",
    re.I,
)


def _trim_bullet(text: str, max_visible: int) -> str:
    """Shorten text to at most max_visible visible characters without breaking its grammar.

    Two safe operations are considered: dropping whole clauses (strict boundaries, the action clause is
    always kept) and cutting the tail at a preposition or connector. Whichever candidate that fits keeps the
    most bold spans (metrics and technologies) wins, then the longest. If nothing fits, the action clause is
    cut at a word boundary.
    """
    if _visible_len(text) <= max_visible:
        return text
    candidates: list[str] = []
    segments = [s for s in _CLAUSE_BREAK.split(text) if s and s.strip()]
    removable = list(range(1, len(segments)))[:10]
    for drop_count in range(1, len(removable) + 1):
        for dropped in itertools.combinations(removable, drop_count):
            candidates.append(" ".join(seg for i, seg in enumerate(segments) if i not in dropped))
    candidates.extend(text[: m.start()] for m in _TAIL_BREAK.finditer(text) if m.start() > 0)

    best: tuple[int, int, str] | None = None
    for candidate in candidates:
        tidy = _tidy_trimmed(candidate)
        length = _visible_len(tidy)
        if not tidy or length > max_visible:
            continue
        score = (len(_BOLD_SPAN.findall(tidy)), length, tidy)
        if best is None or score[:2] > best[:2]:
            best = score
    out = best[2] if best else segments[0]
    if _visible_len(out) > max_visible:
        words = out.split(" ")
        while words and _visible_len(" ".join(words)) > max_visible:
            words.pop()
        out = _tidy_trimmed(" ".join(words))
    return out


def _render_pdf_at(state: ResumeGraphState, resume: dict[str, Any], font_size: float) -> tuple[bytes, int, list[dict[str, Any]]]:
    """Render at a fixed font size (no re-fit): (pdf bytes, page count, detector findings)."""
    from weasyprint import HTML

    manifest = state["template_manifest"]
    template_id = manifest["id"]
    html = TemplateRegistryService.render_template(
        template_id,
        {
            "profile": state["profile"],
            "resume": resume,
            "font_size": font_size,
            "page_margin_mm": manifest.get("page_margin_mm", 15),
            "section_order": state.get("section_order"),
        },
    )
    doc = HTML(string=html, base_url=str(settings.TEMPLATES_DIR / template_id)).render()
    try:
        return doc.write_pdf(), len(doc.pages), detect_orphans_in_weasyprint(doc)
    finally:
        del doc
        gc.collect()


def _resume_bullet_ref(resume: dict[str, Any], finding: dict[str, Any]) -> tuple[list, int, str] | None:
    """(container, index, key) addressing the text of a detector finding inside the resume."""
    section = _SECTION_ALIASES.get(finding.get("section") or "")
    entry, bullet = finding.get("entry_idx"), finding.get("bullet_idx")
    if section is None or entry is None:
        return None
    try:
        if section == "experience":
            return resume["experiences"][entry]["bullet_points"], bullet, ""
        if section == "projects":
            return resume["projects"][entry]["bullet_points"], bullet, ""
        return resume["extracurriculars"], entry, "description"
    except (KeyError, IndexError, TypeError):
        return None


async def finalize_layout_node(state: ResumeGraphState, db: AsyncSession, gen_id: str) -> dict[str, Any]:
    oversize = [o for o in (state.get("orphans") or []) if o.get("fix_type") == "oversize"]
    resume_in = state.get("tailored_resume")
    if not oversize or not resume_in:
        return {}

    resume = copy.deepcopy(resume_in)
    font_size = state.get("font_size") or state["template_manifest"].get("max_font_size", 10.0)
    shrink = 1.0
    trimmed: dict[tuple, tuple[str, str]] = {}
    pdf_bytes, pages, found = b"", state.get("page_count", 1), oversize
    current = oversize

    for _ in range(FINAL_TRIM_MAX_ITER):
        for finding in current:
            ref = _resume_bullet_ref(resume, finding)
            if ref is None:
                continue
            container, index, key = ref
            original = container[index][key] if key else container[index]
            limit = int((finding.get("targetCharsMax") or _visible_len(original)) * shrink)
            shorter = _trim_bullet(original, limit)
            if shorter and shorter != original:
                if key:
                    container[index][key] = shorter
                else:
                    container[index] = shorter
                ident = (finding.get("section"), finding.get("entry_idx"), finding.get("bullet_idx"))
                trimmed[ident] = (trimmed.get(ident, (original, shorter))[0], shorter)
        try:
            pdf_bytes, pages, found = _render_pdf_at(state, resume, font_size)
        except Exception as exc:
            await log_progress(db, gen_id, "renderer", f"Layout guard could not re-render ({exc}); keeping previous render.", "warning")
            return {}
        current = [o for o in found if o.get("fix_type") == "oversize"]
        if not current:
            break
        shrink *= 0.93

    if current:
        await log_progress(
            db, gen_id, "renderer",
            f"Layout guard: {len(current)} bullet(s) still render on 3+ lines after trimming.",
            "warning",
        )
    await log_progress(
        db, gen_id, "renderer",
        f"Layout guard: trimmed {len(trimmed)} bullet(s) that wrapped onto 3+ lines "
        f"(removed {sum(_visible_len(a) - _visible_len(b) for a, b in trimmed.values())} characters).",
        "warning",
    )
    remaining = [o for o in found if o.get("fix_type") == "expand"]
    return {
        "tailored_resume": resume,
        "pdf_bytes": pdf_bytes,
        "page_count": pages,
        "markdown": build_resume_markdown(
            profile=state["profile"], resume=resume, section_order=state.get("section_order")
        ),
        "orphans": remaining or None,
    }


async def content_reduction_node(
    state: ResumeGraphState, db: AsyncSession, gen_id: str
) -> dict[str, Any]:
    """Fit resume within target page count.

    For professional-sans:
      Avoids destructive bullet deletion. Safely preserves original complete PDF
      and warns on overflow; compression is disabled to prevent accepting fabricated facts.

    For other templates:
      Step 0: Remove last bullet from 2nd experience entry.
      Step 1: Remove last bullet from 2nd project entry.
      Step 2+: Exhausted reductions.
    """
    tmpl_id = (state.get("template_manifest") or {}).get("id") or state.get("template_id")
    is_prof_sans = tmpl_id == "professional-sans"
    has_fallback = bool(state.get("experience_fallback")) or bool(state.get("projects_fallback"))
    step = state.get("content_reduction_step", 0)

    if is_prof_sans or has_fallback:
        msg = (
            "Professional Sans overflow: preserving complete content without bullet deletion or compression; setting fit warning."
            if is_prof_sans else
            "Fallback content overflow: preserving complete source content without bullet deletion; setting fit warning."
        )
        await log_progress(
            db,
            gen_id,
            "content_reduction",
            msg,
            "warning",
        )
        return {
            "experience_draft": state.get("experience_draft"),
            "projects_draft": state.get("projects_draft"),
            "content_reduction_step": 2,
        }

    experiences = list(state.get("experience_draft") or [])
    projects = list(state.get("projects_draft") or [])

    if step == 0:
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
            from src.services.pdfium import render_thumbnail
            thumb_bytes = render_thumbnail(pdf_bytes)
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


# ── Orphan repair helpers ─────────────────────────────────────────────────────

# The model cannot see rendered line widths, so a single pass often lands a few
# characters over the two-line limit (a 3rd line) or short of the fill target.
# Each round is verified with a real render; only the bullets that missed are
# sent back, along with the measured result.
ORPHAN_REPAIR_MAX_ROUNDS = 4
ORPHAN_REPAIR_TIME_BUDGET_S = 200.0
# Aim for the middle of the target window. An overshoot is caught by the verify-and-revert
# step and costs one round, while aiming low made weaker models (which land ~5% under the
# number they are given) stall just below the fill floor. Measured on gemini-3.5-flash-lite
# over 4 runs: aim 0.35 left 1-9 short bullets per resume, aim 0.50 left 0-1, both with 0%
# first-round overshoot.
_REPAIR_AIM_FRACTION = 0.5


class _VerifyUnavailable(Exception):
    """The verification render cannot run (missing template/profile or empty HTML)."""


def _clean_bullet_text(s: str) -> str:
    s = re.sub(r"[*_`]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def _visible_len(text: str) -> int:
    return len(text.replace("**", ""))


_SECTION_ALIASES = {
    "experience": "experience", "experiences": "experience",
    "project": "projects", "projects": "projects",
    "extracurricular": "extracurriculars", "extracurriculars": "extracurriculars",
}


def _repair_length_window(orphan: dict[str, Any], current_text: str) -> dict[str, int] | None:
    """Visible-character window that renders as a well-filled 2-line bullet."""
    lo, hi = orphan.get("targetCharsMin"), orphan.get("targetCharsMax")
    if not isinstance(lo, (int, float)) or not isinstance(hi, (int, float)):
        cpl = orphan.get("charsPerLine")
        if not isinstance(cpl, (int, float)) or cpl <= 0:
            return None
        lo, hi = cpl * REPAIR_TARGET_LINES_MIN, cpl * REPAIR_TARGET_LINES_MAX
    lo, hi = int(lo), int(hi)
    current = _visible_len(current_text)
    if hi <= lo:
        return None
    if orphan.get("fix_type") == "oversize":
        return {"min": lo, "max": hi, "aim": lo + round((hi - lo) * _REPAIR_AIM_FRACTION), "current": current}
    if current >= hi - 4:
        return None
    aim = max(lo + round((hi - lo) * _REPAIR_AIM_FRACTION), current + 8)
    return {"min": lo, "max": hi, "aim": min(aim, hi - 2), "current": current}


def _repair_block(
    prompt_index: int,
    context: str,
    base_md: str,
    orphan: dict[str, Any],
    is_larp: bool,
    failure: dict[str, Any] | None = None,
) -> str:
    min_fill = int(orphan.get("minimumLastLineFill", round(ORPHAN_FILL_FLOOR * 100)))
    current_fill = int(orphan.get("lastLineFillPercent", 0))
    detail = (
        "plausible, job-relevant detail or embellishment" if is_larp else "truthful, job-relevant detail"
    )
    window = _repair_length_window(orphan, base_md)
    shorten = orphan.get("fix_type") == "oversize"
    if shorten:
        lines = [
            f"  FIX: SHORTEN this bullet; it currently renders on {orphan.get('renderedLines', 3)} lines and must fit on exactly two.",
            "  Cut filler, repeated ideas and low-value clauses first. Keep every bold metric and tool; never drop a number.",
        ]
    else:
        lines = [
            "  FIX: EXPAND this bullet only; never shorten it or force it onto one line.",
            f"  It currently renders on 2 lines and the final line is {current_fill}% full.",
            f"  Add {detail} until the final rendered line is at least {min_fill}% full.",
        ]
    if window and shorten:
        lines.append(
            f"  LENGTH TARGET: the replacement must be between {window['min']} and {window['max']} visible "
            f"characters (not counting ** markers); aim for about {window['aim']}. The original is "
            f"{window['current']} characters, so remove roughly {max(window['current'] - window['aim'], 0)}. "
            f"Going over {window['max']} wraps onto another line, which is a failure; under {window['min']} leaves an orphan. "
            "Count carefully."
        )
    elif window:
        lines.append(
            f"  LENGTH TARGET: the replacement must be between {window['min']} and {window['max']} visible "
            f"characters (not counting ** markers); aim for about {window['aim']}. The original is "
            f"{window['current']} characters, so keep its wording and add roughly {window['aim'] - window['current']} "
            f"characters (a short clause); do not rewrite it shorter. "
            f"Going over {window['max']} wraps onto a 3rd line, which is a failure and discards the bullet; "
            f"falling under {window['min']} leaves an orphan. Count carefully."
        )
    elif shorten:
        lines.append("  Rewrite it so it renders on exactly two lines.")
    else:
        lines.append(
            "  The renderer will measure the result, so do not estimate character counts or line length."
        )
    if failure:
        kind = failure.get("kind")
        chars = failure.get("chars", 0)
        if kind == "long":
            cut = f" Cut about {max(chars - window['aim'], 1)} characters (target about {window['aim']}, limit {window['max']})." if window else ""
            lines.append(
                f"  PREVIOUS ATTEMPT FAILED (too long): \"{failure['text']}\" was {chars} characters "
                f"and rendered on {failure['lines']} lines.{cut} Make it shorter than that attempt."
            )
        elif kind == "overflow":
            cut = f" Cut about {max(chars - window['aim'], 1)} characters (target about {window['aim']}, limit {window['max']})." if window else ""
            lines.append(
                f"  PREVIOUS ATTEMPT FAILED (too long): \"{failure['text']}\" was {chars} characters "
                f"and pushed the resume past its page limit.{cut} Make it shorter than that attempt."
            )
        elif kind == "short":
            if window and chars < window["current"]:
                fix = (
                    f" It was SHORTER than the original ({window['current']} characters). Never shorten: keep the original "
                    f"wording and add about {max(window['aim'] - window['current'], 1)} characters."
                )
            elif window:
                fix = f" Add about {max(window['aim'] - chars, 1)} more characters (target about {window['aim']})."
            else:
                fix = " Make it longer than that attempt."
            lines.append(
                f"  PREVIOUS ATTEMPT FAILED (too short): \"{failure['text']}\" was {chars} characters "
                f"and left the last line only {failure['fill']}% full (needed {min_fill}%).{fix}"
            )
        elif kind == "unchanged":
            lines.append("  PREVIOUS ROUND: you returned this bullet unchanged. Expand it.")
        elif kind == "missing":
            lines.append("  PREVIOUS ROUND: this bullet was missing from your response. Return it.")
    if is_larp and not shorten:
        metrics, _ = bullet_density(base_md)
        if metrics < 2:
            lines.append(
                f"  This bullet has {metrics} bold metric(s): the added words must include a new bold metric."
            )
    return f"Bullet {prompt_index}:\n  {context}\n  Original: \"{base_md}\"\n" + "\n".join(lines)


def _entry_text(experiences: list, projects: list, extracurriculars: list, entry: dict[str, Any]) -> str:
    section, item, bullet = entry["section_key"], entry["item_idx"], entry["bullet_idx"]
    if section == "experience":
        return experiences[item]["bullet_points"][bullet]
    if section == "projects":
        return projects[item]["bullet_points"][bullet]
    return extracurriculars[item]["description"]


def _set_entry_text(
    experiences: list, projects: list, extracurriculars: list, entry: dict[str, Any], text: str
) -> None:
    section, item, bullet = entry["section_key"], entry["item_idx"], entry["bullet_idx"]
    if section == "experience":
        experiences[item]["bullet_points"][bullet] = text
    elif section == "projects":
        projects[item]["bullet_points"][bullet] = text
    else:
        extracurriculars[item]["description"] = text


def _match_orphan(entry: dict[str, Any], orphans: list[dict[str, Any]], current_text: str) -> dict[str, Any] | None:
    """Find the detector finding for a repaired bullet: stable identity first, then text."""
    clean = _clean_bullet_text(current_text)
    for found in orphans:
        if (
            found.get("section") is not None
            and found.get("entry_idx") is not None
            and found.get("bullet_idx") is not None
        ):
            if (
                _SECTION_ALIASES.get(found["section"]) == entry["section_key"]
                and found["entry_idx"] == entry["item_idx"]
                and found["bullet_idx"] == entry["bullet_idx"]
            ):
                return found
        elif _clean_bullet_text(found.get("text", "")) == clean:
            return found
    return None


def _parse_repair_response(raw_text: str) -> dict[int, str]:
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw_text, re.DOTALL)
    if fenced:
        json_text = fenced.group(1).strip()
    else:
        start, end = raw_text.find("{"), raw_text.rfind("}")
        json_text = raw_text[start:end + 1] if start != -1 and end != -1 else raw_text
    bullets = json.loads(json_text).get("bullets", [])
    replacements: dict[int, str] = {}
    for item in bullets:
        if not isinstance(item, dict):
            continue
        try:
            index = int(item.get("index"))
        except (TypeError, ValueError):
            continue
        text = item.get("replacement")
        if isinstance(text, str) and text.strip():
            replacements[index] = text.strip()
    if bullets and not replacements:
        raise ValueError("response used an incompatible schema; expected a non-empty 'replacement' per bullet")
    return replacements


def _render_for_verification(
    state: ResumeGraphState, experiences: list, projects: list, extracurriculars: list
) -> tuple[int, list[dict[str, Any]]]:
    """Render the candidate at the current font size; return (page_count, orphans)."""
    manifest = state.get("template_manifest") or {}
    profile = state.get("profile") or {}
    template_id = manifest.get("id") or state.get("template_id")
    if not (template_id and profile):
        raise _VerifyUnavailable("missing template or profile")

    from weasyprint import HTML as _VerifyHTML  # type: ignore[import-untyped]

    base_resume = dict(state.get("tailored_resume") or {})
    if not base_resume:
        summary_draft = state.get("summary_draft") or {}
        base_resume = {
            "summary": summary_draft.get("summary"),
            "skills": summary_draft.get("skills"),
            "education": state.get("education") or [],
        }
    candidate = dict(base_resume)
    candidate["experiences"] = experiences
    candidate["projects"] = projects
    candidate["extracurriculars"] = extracurriculars

    html = TemplateRegistryService.render_template(
        template_id,
        {
            "profile": profile,
            "resume": candidate,
            "font_size": state.get("font_size") or manifest.get("max_font_size", 10.0),
            "page_margin_mm": manifest.get("page_margin_mm", 15),
            "section_order": state.get("section_order"),
        },
    )
    if not html:
        raise _VerifyUnavailable("verification render is empty")
    doc = _VerifyHTML(string=html, base_url=str(settings.TEMPLATES_DIR / template_id)).render()
    try:
        return len(doc.pages), detect_orphans_in_weasyprint(doc)
    finally:
        del doc
        gc.collect()


_REPAIR_BUDGET_RULES = (
    "HOW THE CHARACTER BUDGET WORKS:\n"
    "- Every bullet has its own LENGTH TARGET: a window of visible characters (** markers excluded), measured from how that "
    "bullet actually rendered. Budgets differ per bullet because wording changes how much fits on a line.\n"
    "- Write about the \"aim for about\" value. MAX is a hard ceiling: one more character wraps onto a 3rd line and the bullet "
    "is discarded. Below MIN the last line stays an orphan.\n"
    "- A bullet marked PREVIOUS ATTEMPT FAILED was already rendered; its numbers are real. Move toward the aim value.\n"
    "- A bullet with no LENGTH TARGET has no measured budget: expand it by one short clause, do not pad, never shorten it.\n"
)


def orphan_repair_default_prompts(is_larp: bool) -> tuple[str, str]:
    """Default (system, user) prompts for orphan repair; also what the DB rows are seeded with."""
    if is_larp:
        default_system = (
            "ROLE: Precise resume line-wrap repair editor.\n"
            "TASK: Rewrite only specified bullets so rendered PDF line lengths fit constraints.\n"
            "OUTPUT CONTRACT: Return only one raw JSON object with key 'bullets'. No markdown fences, no prose, no comments.\n"
            "QUALITY BAR: Embellish creatively to fit layout constraints while preserving role, company, and JD alignment."
        )
        truth_rule = (
            "- LARP MODE: you may embellish freely with plausible JD-aligned metrics, tools, and scale; never new employers or roles; never shorten a bullet marked EXPAND."
        )
    else:
        default_system = (
            "ROLE: Precise resume line-wrap repair editor.\n"
            "TASK: Rewrite only specified bullets so rendered PDF line lengths fit constraints.\n"
            "OUTPUT CONTRACT: Return only one raw JSON object with key 'bullets'. No markdown fences, no prose, no comments.\n"
            "QUALITY BAR: Preserve meaning and truth while meeting layout constraints."
        )
        truth_rule = (
            "- Expand only by adding job-relevant supported technical detail; never shorten or compress a bullet marked EXPAND.\n"
            "- Keep the core meaning and factual claims of the original; do not invent unsupported metrics or facts."
        )

    default_user = (
        "OUTPUT FORMAT - MANDATORY RAW JSON ONLY:\n"
        "{\n"
        '  "bullets": [\n'
        '    {"index": 1, "replacement": "Rewritten bullet text here."},\n'
        '    {"index": 2, "replacement": "..."}\n'
        "  ]\n"
        "}\n\n"
        "INPUT: Rendering Context\n"
        "Font: Proportional font. Every bullet has its own measured character budget.\n\n"
        f"{_REPAIR_BUDGET_RULES}\n"
        "RULES:\n"
        "- Return one replacement for every Bullet listed below, using same index values.\n"
        "- Character counts are visible characters only. Markdown bold markers (**) do not count.\n"
        "- Start every bullet with a strong action verb.\n"
        "- Keep every bold metric and tool already in the bullet. Bold each new number with its unit and each tool name.\n"
        "- A bullet marked SHORTEN loses filler and repeated ideas, never a metric or a tool.\n"
        "- Fill with substance (a metric, a tool, a scale), never filler such as seamlessly, robust, reliably, comprehensive, today, in practice.\n"
        f"{truth_rule}\n"
        "- No emojis, no trailing explanations, no omitted bullets.\n\n"
        "INPUT: Job-Relevant Keywords\n{kw_text}\n\n"
        "INPUT: Bullets To Repair\n{bullet_blocks}\n\n"
        "Return only the raw JSON object."
    )
    return default_system, default_user


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

    clean_text = _clean_bullet_text

    def history_key(section, item_idx, bullet_idx):
        return f"{section}:{item_idx}:{bullet_idx}"

    mapping = []
    reverted = 0

    for idx, orphan in enumerate(orphans, start=1):
        orphan_clean = clean_text(orphan["text"])
        match = None

        orphan_sec = orphan.get("section")
        orphan_entry_idx = orphan.get("entry_idx")
        orphan_bullet_idx = orphan.get("bullet_idx")

        # 1. Stable identity match
        if orphan_sec and orphan_entry_idx is not None and orphan_bullet_idx is not None:
            if orphan_sec in ("experience", "experiences") and 0 <= orphan_entry_idx < len(experiences):
                exp_bullets = experiences[orphan_entry_idx].get("bullet_points") or []
                if 0 <= orphan_bullet_idx < len(exp_bullets):
                    match = ("experience", orphan_entry_idx, orphan_bullet_idx, exp_bullets[orphan_bullet_idx])
            elif orphan_sec in ("project", "projects") and 0 <= orphan_entry_idx < len(projects):
                proj_bullets = projects[orphan_entry_idx].get("bullet_points") or []
                if 0 <= orphan_bullet_idx < len(proj_bullets):
                    match = ("projects", orphan_entry_idx, orphan_bullet_idx, proj_bullets[orphan_bullet_idx])
            elif orphan_sec in ("extracurricular", "extracurriculars") and 0 <= orphan_entry_idx < len(extracurriculars_draft):
                desc = extracurriculars_draft[orphan_entry_idx].get("description", "")
                match = ("extracurriculars", orphan_entry_idx, 0, desc)

        # 2. Section-scoped text match if section is known
        if not match and orphan_sec:
            if orphan_sec in ("project", "projects"):
                for proj_idx, proj in enumerate(projects):
                    for bullet_idx, bullet in enumerate(proj.get("bullet_points") or []):
                        if clean_text(bullet) == orphan_clean:
                            match = ("projects", proj_idx, bullet_idx, bullet)
                            break
                    if match:
                        break
            elif orphan_sec in ("experience", "experiences"):
                for exp_idx, exp in enumerate(experiences):
                    for bullet_idx, bullet in enumerate(exp.get("bullet_points") or []):
                        if clean_text(bullet) == orphan_clean:
                            match = ("experience", exp_idx, bullet_idx, bullet)
                            break
                    if match:
                        break
            elif orphan_sec in ("extracurricular", "extracurriculars"):
                for ex_idx, ex in enumerate(extracurriculars_draft):
                    desc = ex.get("description", "")
                    if desc and clean_text(desc) == orphan_clean:
                        match = ("extracurriculars", ex_idx, 0, desc)
                        break

        # 3. Fallback across all sections
        if not match:
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

        if orphan.get("fix_type") not in ("expand", "oversize"):
            continue

        mapping.append({
            "prompt_index": idx,
            "section_key": section_key,
            "item_idx": item_idx,
            "bullet_idx": bullet_idx,
            "original_md": original_md,
            "history_key": hkey,
            "context": context,
            "orphan": orphan,
        })

    if reverted:
        await log_progress(
            db, gen_id, "orphan_repair",
            f"Reverted {reverted} bullet(s) to pre-repair originals due to >2 line regression.",
        )

    if not mapping:
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

    mode = _creativity_mode(state)
    is_larp = mode in ("larp", "super_larp")
    prompt_name = _prompt_name("orphan_repair", mode)

    default_system, default_user = orphan_repair_default_prompts(is_larp)

    sys_prompt, usr_prompt = await get_prompt_config(
        db,
        prompt_name,
        default_system=default_system,
        default_user=default_user,
    )
    sys_prompt += _professional_sans_policy(state, "orphan_repair")

    target_pages = (state.get("template_manifest") or {}).get("target_pages", 1)
    pre_repair_pages = state.get("page_count", 1)

    pending = [dict(entry, base_md=entry["original_md"], failure=None) for entry in mapping]
    fixed_keys: set[str] = set()   # bullets that now render as a well-filled 2-line bullet
    rounds_run = 0
    started = time.monotonic()

    for round_no in range(1, ORPHAN_REPAIR_MAX_ROUNDS + 1):
        if not pending:
            break
        if round_no > 1 and time.monotonic() - started > ORPHAN_REPAIR_TIME_BUDGET_S:
            await log_progress(
                db, gen_id, "orphan_repair",
                f"Repair time budget reached; leaving {len(pending)} bullet(s) as they are.",
                "warning",
            )
            break
        rounds_run = round_no
        if round_no > 1:
            await log_progress(
                db, gen_id, "orphan_repair",
                f"Round {round_no}/{ORPHAN_REPAIR_MAX_ROUNDS}: re-asking for {len(pending)} bullet(s) with measured feedback...",
            )

        for number, entry in enumerate(pending, start=1):
            entry["prompt_index"] = number
        bullet_blocks = [
            _repair_block(e["prompt_index"], e["context"], e["base_md"], e["orphan"], is_larp, e["failure"])
            for e in pending
        ]
        formatted_usr_prompt = _replace_prompt_vars(
            usr_prompt,
            {"kw_text": kw_text, "bullet_blocks": "\n\n".join(bullet_blocks)},
        )

        raw_response = ""
        try:
            from langchain_core.messages import SystemMessage, HumanMessage
            # invoke_with_fallback only bounds a single attempt, so cap the whole call
            # (attempts x fallback targets) by what is left of the node's time budget.
            remaining = ORPHAN_REPAIR_TIME_BUDGET_S - (time.monotonic() - started)
            resp = await asyncio.wait_for(
                invoke_with_fallback(
                    lambda llm, p: llm,
                    [SystemMessage(content=sys_prompt), HumanMessage(content=formatted_usr_prompt)],
                    node_name="orphan_repair",
                    gen_id=gen_id,
                    is_pro=state.get("is_pro", False),
                ),
                timeout=max(remaining, 1.0),
            )
            content = resp.content
            if isinstance(content, list):
                raw_response = "".join(
                    part if isinstance(part, str) else part.get("text", "")
                    for part in content
                    if isinstance(part, str) or (isinstance(part, dict) and part.get("type") == "text")
                ).strip()
            else:
                raw_response = str(content).strip()
        except Exception as e:
            await log_progress(
                db, gen_id, "orphan_repair", f"Error calling LLM for orphan repair: {e or type(e).__name__}", "error",
            )
            if round_no == 1:
                return {
                    "orphans": None,
                    "repair_attempts": state.get("repair_attempts", 0) + 1,
                    "repair_history": repair_history,
                }
            break

        try:
            replacements = _parse_repair_response(raw_response)
        except Exception as e:
            await log_progress(
                db, gen_id, "orphan_repair",
                f"Error parsing LLM repair response: {e}. Raw response:\n{raw_response}",
                "error",
            )
            continue

        round_snapshot = (
            copy.deepcopy(experiences),
            copy.deepcopy(projects),
            copy.deepcopy(extracurriculars_draft),
            copy.deepcopy(repair_history),
        )

        def _revert_entries(entries: list[dict[str, Any]]) -> None:
            for item in entries:
                _set_entry_text(experiences, projects, extracurriculars_draft, item, item["base_md"])
                if item["added_history"]:
                    repair_history.pop(item["history_key"], None)

        applied: list[dict[str, Any]] = []
        for entry in pending:
            new_text = replacements.get(entry["prompt_index"])
            if not new_text:
                entry["failure"] = entry["failure"] or {"kind": "missing"}
                continue
            if new_text == entry["base_md"].strip():
                # Unchanged: nothing to verify. Keep any measured feedback from an earlier round.
                entry["failure"] = entry["failure"] or {"kind": "unchanged"}
                continue
            entry["added_history"] = entry["history_key"] not in repair_history
            if entry["added_history"]:
                repair_history[entry["history_key"]] = entry["original_md"]
            _set_entry_text(experiences, projects, extracurriculars_draft, entry, new_text)
            entry["new_text"] = new_text
            applied.append(entry)

        if not applied:
            await log_progress(
                db, gen_id, "orphan_repair",
                "Repair round returned no changed bullets; stopping.",
                "warning",
            )
            break

        # ── Verify with a real render; keep what fits, revert only what does not ──
        outcomes: dict[str, str] = {}
        failure_text: dict[str, str] = {}
        try:
            pages, found = _render_for_verification(state, experiences, projects, extracurriculars_draft)

            def _still_too_long(entry: dict[str, Any]) -> bool:
                m = _match_orphan(entry, found, _entry_text(experiences, projects, extracurriculars_draft, entry))
                if not m or m.get("renderedLines", 0) <= 2:
                    return False
                # A shortened bullet that lost lines is progress even if still over two.
                before = entry["orphan"].get("renderedLines", 2) if entry["orphan"].get("fix_type") == "oversize" else 2
                return m["renderedLines"] >= before

            grown = [e for e in applied if _still_too_long(e)]
            if grown:
                for e in grown:
                    outcomes[e["history_key"]] = "long"
                    failure_text[e["history_key"]] = e["new_text"]
                    e["failure_lines"] = (_match_orphan(
                        e, found, e["new_text"]) or {}).get("renderedLines", 3)
                _revert_entries(grown)
                await log_progress(
                    db, gen_id, "orphan_repair",
                    f"Verification: {len(grown)} repaired bullet(s) grew to 3+ lines after filling. "
                    "Reverted to pre-repair originals.",
                    "warning",
                )
                # Re-measure without the overshooting bullets before judging page fit.
                pages, found = _render_for_verification(state, experiences, projects, extracurriculars_draft)

            if pages > target_pages and pre_repair_pages <= target_pages:
                survivors = [e for e in applied if e["history_key"] not in outcomes]
                for e in survivors:
                    outcomes[e["history_key"]] = "overflow"
                    failure_text[e["history_key"]] = e["new_text"]
                _revert_entries(survivors)
                await log_progress(
                    db, gen_id, "orphan_repair",
                    f"Verification: expansion pushed resume to {pages} page(s) (target {target_pages}). "
                    f"Reverted {len(survivors)} repair(s) to pre-repair originals to preserve page fit.",
                    "warning",
                )
            else:
                for e in applied:
                    if e["history_key"] in outcomes:
                        continue
                    still = _match_orphan(
                        e, found, _entry_text(experiences, projects, extracurriculars_draft, e)
                    )
                    if still is None:
                        outcomes[e["history_key"]] = "ok"
                    elif still.get("fix_type") == "oversize":
                        outcomes[e["history_key"]] = "short"
                        e["next_orphan"] = still
                    elif still.get("lastLineFillPercent", 0) <= e["orphan"].get("lastLineFillPercent", 0):
                        # Still an orphan and no fuller than before: not an improvement.
                        outcomes[e["history_key"]] = "worse"
                        failure_text[e["history_key"]] = e["new_text"]
                        e["failure_fill"] = still.get("lastLineFillPercent", 0)
                    else:
                        outcomes[e["history_key"]] = "short"
                        e["next_orphan"] = still
        except _VerifyUnavailable as ve:
            await log_progress(
                db, gen_id, "orphan_repair",
                f"Verification cannot be performed ({ve}); rolling back repairs to pre-repair originals.",
                "warning",
            )
            experiences, projects, extracurriculars_draft, repair_history = round_snapshot
            break
        except Exception as ve:
            await log_progress(
                db, gen_id, "orphan_repair",
                f"Verification error ({ve}); rolling back repairs to pre-repair originals.",
                "warning",
            )
            experiences, projects, extracurriculars_draft, repair_history = round_snapshot
            break

        next_pending: list[dict[str, Any]] = []
        for entry in pending:
            key = entry["history_key"]
            outcome = outcomes.get(key)
            if outcome == "ok":
                fixed_keys.add(key)
                continue
            if outcome == "short":
                # Text stays (it is fuller than before); ask again from the new text.
                entry["base_md"] = entry["new_text"]
                entry["orphan"] = entry.pop("next_orphan")
                entry["failure"] = None
            elif outcome == "worse":
                _revert_entries([entry])
                entry["failure"] = {
                    "kind": "short",
                    "text": failure_text[key],
                    "chars": _visible_len(failure_text[key]),
                    "fill": entry.get("failure_fill", 0),
                }
            elif outcome in ("long", "overflow"):
                entry["failure"] = {
                    "kind": "long" if outcome == "long" else "overflow",
                    "text": failure_text[key],
                    "chars": _visible_len(failure_text[key]),
                    "lines": entry.get("failure_lines", 3),
                }
            next_pending.append(entry)
        pending = next_pending

    kept = sum(
        1 for e in mapping
        if e["history_key"] in repair_history
        and _entry_text(experiences, projects, extracurriculars_draft, e) != repair_history[e["history_key"]]
    )
    await log_progress(
        db, gen_id, "orphan_repair",
        f"Successfully repaired and applied {kept}/{len(mapping)} bullet point(s); "
        f"{len(fixed_keys)} now fill their last line, after {rounds_run} round(s).",
    )

    return {
        "experience_draft": experiences,
        "projects_draft": projects,
        "extracurriculars_draft": extracurriculars_draft,
        "orphans": None,
        "repair_attempts": state.get("repair_attempts", 0) + 1,
        "repair_history": repair_history,
    }
