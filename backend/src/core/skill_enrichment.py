"""Fill a thin skills section from what the candidate has actually built.

The skills step used to see only ``profile.skills`` (often 2-3 items), so a resume could show
``Languages: Python`` and ``Frontend: React`` even when the candidate's projects used FastAPI,
PostgreSQL, Docker and PyTorch. This module collects the candidate's *evidence* (profile skills,
every project's technologies, and known technologies named in experience and project bullets)
and tops the generated skills up from it, most job-relevant first.

Nothing is invented: every skill added here comes from the candidate's own material, so it is
safe in every creativity mode, including ``proper``.
"""

from __future__ import annotations

import re
from typing import Any, Iterable

# Canonical spelling per family. Used to classify a skill and to restore clean casing for skills
# found by scanning free text. Anything not listed is still usable evidence (family "other").
_FAMILIES: dict[str, list[str]] = {
    "languages": [
        "Python", "JavaScript", "TypeScript", "Java", "C", "C++", "C#", "Go", "Rust", "SQL", "Dart", "Kotlin",
        "Swift", "Bash", "R", "PHP", "Ruby", "Scala", "MATLAB", "CUDA",
    ],
    "frontend": [
        "React", "Next.js", "Vue.js", "Angular", "Svelte", "Tailwind CSS", "Vite", "Redux", "GSAP", "React Native",
        "Expo", "Flutter", "Three.js", "Framer Motion", "Bootstrap", "Material UI", "Webpack", "HTML", "CSS",
        "Android", "p5.js", "Streamlit",
    ],
    "backend": [
        "FastAPI", "Flask", "Django", "Node.js", "Express", "Spring Boot", "Celery", "Pydantic", "SQLAlchemy",
        "SQLModel", "REST", "GraphQL", "JWT", "gRPC", "WebSockets", "Kafka", "RabbitMQ", "OAuth",
    ],
    "data": [
        "PostgreSQL", "MySQL", "SQLite", "MongoDB", "Redis", "Supabase", "pgvector", "Firebase", "Pandas", "NumPy",
        "Spark", "Elasticsearch", "Neo4j", "DynamoDB", "Pinecone", "Chroma", "FAISS",
    ],
    "ai": [
        "PyTorch", "TensorFlow", "scikit-learn", "Hugging Face", "Transformers", "LangChain", "LangGraph", "CrewAI",
        "LlamaIndex", "OpenAI API", "Claude API", "Gemini API", "vLLM", "LLaMA", "Qwen", "RAG", "OpenCV", "librosa",
        "XGBoost", "Keras", "MLflow", "Prompt Engineering", "NLP", "Computer Vision",
    ],
    "devops": [
        "Docker", "Kubernetes", "Git", "GitHub Actions", "AWS", "GCP", "Azure", "Linux", "Nginx", "CI/CD", "pytest",
        "Terraform", "Jest", "Postman", "Vercel",
    ],
}

_FAMILY_DISPLAY = {
    "languages": "Languages",
    "frontend": "Frontend",
    "backend": "Backend & APIs",
    "data": "Databases & Data",
    "ai": "AI & ML",
    "devops": "DevOps & Tools",
    "other": "Tools & Frameworks",
}

# An existing category (whatever the model called it) accepts a family if its name contains a hint.
_CATEGORY_HINTS = {
    "languages": ("language", "programming"),
    "frontend": ("frontend", "front end", "front-end", "web", "mobile", "ui"),
    "backend": ("backend", "back end", "back-end", "api", "server", "framework"),
    "data": ("database", "data", "storage"),
    "ai": ("ai", "ml", "machine learning", "llm", "agent", "rag", "deep learning", "generative", "nlp"),
    "devops": ("devops", "cloud", "infrastructure", "deployment", "tool", "testing"),
    "other": ("tool", "framework", "technolog", "platform"),
}

# Where a skill goes when its own family has no category and the section is already at its category limit.
_FALLBACK_FAMILIES = {
    "languages": [],
    "frontend": ["languages"],
    "backend": ["data", "ai"],
    "data": ["backend", "ai"],
    "ai": ["backend", "data"],
    "devops": ["backend", "data", "ai"],
    "other": ["backend", "ai", "frontend"],
}

# Too ambiguous to find by scanning prose ("go", "r", "c", "express" ...); fine from structured fields.
_NO_TEXT_SCAN = {"c", "r", "go", "express", "git", "rest", "rag", "expo", "css", "html", "swift", "scala"}


def _key(name: str) -> str:
    return re.sub(r"[^a-z0-9+#]", "", name.casefold())


_FAMILY_OF: dict[str, str] = {}
_CANONICAL: dict[str, str] = {}
for _family, _names in _FAMILIES.items():
    for _name in _names:
        _FAMILY_OF[_key(_name)] = _family
        _CANONICAL[_key(_name)] = _name
_FAMILY_OF.update({"nodejs": "backend", "nextjs": "frontend", "vuejs": "frontend", "reactjs": "frontend",
                   "sqlite3": "data", "postgres": "data", "scikitlearn": "ai", "huggingfacetransformers": "ai",
                   "googlegenerativeai": "ai", "tailwind": "frontend", "golang": "languages",
                   "githubactions": "devops", "html5": "frontend", "css3": "frontend"})
_CANONICAL.update({"reactjs": "React", "postgres": "PostgreSQL", "golang": "Go", "tailwind": "Tailwind CSS",
                   "html5": "HTML", "css3": "CSS", "huggingfacetransformers": "Hugging Face Transformers"})

_TEXT_SCAN = re.compile(
    r"(?<![A-Za-z0-9.+#])("
    + "|".join(
        re.escape(n)
        for n in sorted({n for names in _FAMILIES.values() for n in names if _key(n) not in _NO_TEXT_SCAN}, key=len, reverse=True)
    )
    + r")(?![A-Za-z0-9+#])",
    re.I,
)


def family_of(name: str) -> str:
    return _FAMILY_OF.get(_key(name), "other")


def _display(name: str) -> str:
    return _CANONICAL.get(_key(name), name.strip())


def _as_list(value: Any) -> list[str]:
    if isinstance(value, str):
        return [p.strip() for p in value.split(",") if p.strip()]
    if isinstance(value, dict):
        return [str(x).strip() for items in value.values() for x in (items or []) if str(x).strip()]
    if isinstance(value, Iterable):
        return [str(x).strip() for x in value if str(x).strip()]
    return []


def build_candidate_evidence(
    profile_skills: Any, projects: list[dict], experiences: list[dict]
) -> dict[str, Any]:
    """Snapshot of everything the candidate's material says they can do (kept in graph state)."""
    return {
        "profile_skills": _as_list(profile_skills),
        "projects": [
            {
                "name": p.get("name") or "",
                "technologies": _as_list(p.get("technologies")),
                "text": " ".join(str(b) for b in (p.get("bullet_points") or [])) + " " + str(p.get("description") or ""),
            }
            for p in projects or []
        ],
        "experiences": [
            {
                "role": e.get("role") or "",
                "organization": e.get("organization") or "",
                "bullets": [str(b) for b in (e.get("bullet_points") or []) if str(b).strip()],
            }
            for e in experiences or []
        ],
    }


def evidence_text(evidence: dict[str, Any], max_chars: int = 2600) -> str:
    """Compact digest shown to the model so it can build skills from real material."""
    lines: list[str] = []
    if evidence.get("profile_skills"):
        lines.append("Profile skills: " + ", ".join(evidence["profile_skills"]))
    for p in evidence.get("projects") or []:
        if p.get("technologies"):
            lines.append(f"Project {p['name']}: " + ", ".join(p["technologies"]))
    for e in evidence.get("experiences") or []:
        bullets = " | ".join(b[:200] for b in e.get("bullets", [])[:4])
        lines.append(f"Experience {e['role']} @ {e['organization']}: {bullets}")
    return "\n".join(lines)[:max_chars]


def collect_evidence_skills(evidence: dict[str, Any], selected_project_names: Iterable[str] = ()) -> list[dict[str, Any]]:
    """Distinct skills the candidate has shown, with how often and whether a shown project uses them."""
    selected = {n.casefold() for n in selected_project_names}
    found: dict[str, dict[str, Any]] = {}

    def add(name: str, weight: int, in_selected: bool) -> None:
        k = _key(name)
        if not k:
            return
        entry = found.setdefault(k, {"name": _display(name), "count": 0, "selected": False, "order": len(found)})
        entry["count"] += weight
        entry["selected"] = entry["selected"] or in_selected

    for skill in evidence.get("profile_skills") or []:
        add(skill, 2, False)
    for project in evidence.get("projects") or []:
        in_selected = str(project.get("name", "")).casefold() in selected
        for tech in project.get("technologies") or []:
            add(tech, 1, in_selected)
        for match in _TEXT_SCAN.finditer(project.get("text") or ""):
            add(match.group(1), 1, in_selected)
    for experience in evidence.get("experiences") or []:
        for match in _TEXT_SCAN.finditer(" ".join(experience.get("bullets") or [])):
            add(match.group(1), 1, False)
    return list(found.values())


def _matches_job(name: str, terms: list[str]) -> bool:
    n = _key(name)
    if not n:
        return False
    for t in terms:
        if n == t or (len(n) >= 3 and (n in t or (len(t) >= 3 and t in n))):
            return True
    return False


def _is_soft(category: str) -> bool:
    return "soft" in category.casefold()


def _has_hint(category: str, family: str) -> bool:
    """Word-based match so "ui" does not hit "building" or "ai" does not hit "tailored"."""
    text = " ".join(re.findall(r"[a-z0-9]+", category.casefold()))
    tokens = text.split()
    for hint in _CATEGORY_HINTS[family]:
        if " " in hint or "-" in hint:
            if hint.replace("-", " ") in text:
                return True
        elif len(hint) <= 3:
            if hint in tokens:
                return True
        elif any(t.startswith(hint) for t in tokens):
            return True
    return False


def _home(category_names: list[str], family: str) -> str | None:
    for name in category_names:
        if not _is_soft(name) and _has_hint(name, family):
            return name
    return None


def enrich_skills(
    skills: dict[str, list[str]],
    evidence_skills: list[dict[str, Any]],
    job_terms: Iterable[str],
    *,
    floor_total: int = 16,
    floor_per_category: int = 3,
    max_total: int = 24,
    max_categories: int = 6,
    per_category_cap: int = 8,
) -> dict[str, list[str]]:
    """Top up ``skills`` from the candidate's own evidence, most job-relevant first.

    1. Every evidenced skill the job asks for is added (up to ``max_total``).
    2. Each non-soft category is brought up to ``floor_per_category`` from matching evidence.
    3. The section is topped up to ``floor_total`` by overall relevance.
    Soft-skill categories are never touched. Existing items keep their order; job-relevant items
    are moved to the front of each category.
    """
    terms = [_key(t) for t in job_terms if _key(str(t))]
    result: dict[str, list[str]] = {k: list(v) for k, v in skills.items()}
    present = {_key(s) for items in result.values() for s in items}
    total = sum(len(v) for v in result.values())

    candidates = [c for c in evidence_skills if _key(c["name"]) not in present]
    for c in candidates:
        c["family"] = family_of(c["name"])
        c["job"] = _matches_job(c["name"], terms)
    candidates.sort(key=lambda c: (not c["job"], not c["selected"], -c["count"], c["order"]))

    def place(c: dict[str, Any], create_ok: bool = True) -> bool:
        nonlocal total
        if total >= max_total or _key(c["name"]) in present:
            return False
        names = list(result)
        home = _home(names, c["family"])
        if home is None and (not create_ok or len(names) >= max_categories):
            # No room for a new category: join the closest existing one instead of dropping the skill.
            for fallback in _FALLBACK_FAMILIES[c["family"]]:
                home = _home(names, fallback)
                if home:
                    break
            if home is None:
                return False
        if home is None:
            home = _FAMILY_DISPLAY[c["family"]]
            # keep Soft Skills last
            soft = {k: result.pop(k) for k in list(result) if _is_soft(k)}
            result[home] = []
            result.update(soft)
        if len(result[home]) >= per_category_cap:
            return False
        result[home].append(c["name"])
        present.add(_key(c["name"]))
        total += 1
        return True

    for c in [c for c in candidates if c["job"]]:
        place(c)

    for category in [k for k in result if not _is_soft(k)]:
        families = [f for f in _CATEGORY_HINTS if _has_hint(category, f)]
        for c in candidates:
            if len(result[category]) >= floor_per_category or total >= max_total:
                break
            if c["family"] in families and _key(c["name"]) not in present and len(result[category]) < per_category_cap:
                result[category].append(c["name"])
                present.add(_key(c["name"]))
                total += 1

    for c in candidates:
        if total >= floor_total:
            break
        place(c)

    for category, items in result.items():
        if not _is_soft(category):
            items.sort(key=lambda s: not _matches_job(s, terms))  # stable: job-relevant first
    return result
