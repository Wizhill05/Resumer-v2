"""A thin skills section is topped up from the candidate's own projects and experience, in every mode."""

import re
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from src.core import skill_enrichment as se
from src.pipeline import nodes as nodes_mod
from src.schemas.pipeline import TailoredSummaryAndSkills

# The real shape of the reported profile: 3 profile skills, many project technologies.
PROJECTS = [
    {"name": "clean-transactions", "technologies": ["Python", "FastAPI", "Celery", "Redis", "PostgreSQL", "SQLAlchemy", "Docker", "Pydantic"]},
    {"name": "GigaMind", "technologies": ["TypeScript", "Python", "FastAPI", "PostgreSQL", "pgvector", "React", "Tailwind CSS", "Docker"]},
    {"name": "Resumer-v2", "technologies": ["LangChain", "LangGraph", "OpenAI API", "FastAPI", "PostgreSQL", "Docker", "pytest"]},
    {"name": "Graxy", "technologies": ["CUDA"]},
    {"name": "Meals", "technologies": ["Dart", "Flutter"]},
]
EXPERIENCES = [{"role": "AI Engineer Intern", "organization": "X", "bullet_points": ["Built LangChain agents on Node.js APIs backed by MongoDB"]}]
THIN = {
    "Languages": ["Python"],
    "Frontend": ["React"],
    "AI & Application Development": ["Agentic AI", "LLM Applications"],
    "Soft Skills": ["Problem Solving", "Adaptability"],
}
JOB = ["Python", "FastAPI", "PostgreSQL", "Docker", "LLM", "REST APIs"]


def _enrich(skills=None, **kwargs):
    evidence = se.build_candidate_evidence(["React", "Python", "Agentic AI"], PROJECTS, EXPERIENCES)
    found = se.collect_evidence_skills(evidence, ["clean-transactions", "GigaMind"])
    return se.enrich_skills(dict(skills or THIN), found, JOB, **kwargs), found


def _flat(skills):
    return [s for items in skills.values() for s in items]


def test_thin_section_is_filled_and_every_added_skill_comes_from_the_candidate():
    out, found = _enrich()
    evidence_names = {s["name"].casefold() for s in found}
    added = [s for s in _flat(out) if s not in _flat(THIN)]
    assert len(_flat(out)) >= 16
    assert added and all(s.casefold() in evidence_names for s in added), added  # nothing invented
    for category, items in out.items():
        if "soft" not in category.lower():
            assert len(items) >= 3, (category, items)


def test_job_relevant_skills_lead_and_are_never_dropped():
    out, _ = _enrich()
    assert out["Languages"][0] == "Python"
    for needed in ("FastAPI", "PostgreSQL", "Docker"):
        assert needed in _flat(out), needed
    backend = next(v for k, v in out.items() if "backend" in k.lower())
    assert backend[0] == "FastAPI"  # job skills sorted to the front of their category


def test_soft_skills_are_untouched_and_stay_last():
    out, _ = _enrich()
    assert out["Soft Skills"] == ["Problem Solving", "Adaptability"]
    assert list(out)[-1] == "Soft Skills"


def test_category_limit_is_respected_and_skills_join_the_closest_category():
    out, _ = _enrich(max_categories=4)
    assert len(out) <= 4
    assert "Docker" in _flat(out)  # no DevOps category possible, so it joins the closest one


def test_caps_and_floors():
    out, _ = _enrich(floor_total=10, max_total=12)
    assert len(_flat(out)) <= 12
    big, _ = _enrich(max_total=40, per_category_cap=4)
    assert all(len(v) <= 4 for k, v in big.items() if "soft" not in k.lower() and len(THIN.get(k, [])) <= 4)


def test_existing_skills_are_not_duplicated_across_spellings():
    skills = {"Backend": ["NodeJS", "fastapi"], "Soft Skills": ["Teamwork"]}
    out, _ = _enrich(skills)
    flat = [re.sub(r"[^a-z0-9]", "", s.lower()) for s in _flat(out)]
    assert len(flat) == len(set(flat))


def test_full_section_is_left_alone():
    full = {"Languages": ["Python", "TypeScript", "SQL"], "Backend": ["FastAPI", "Node.js", "Celery", "Pydantic"],
            "AI": ["LangChain", "PyTorch", "OpenAI API"], "Data": ["PostgreSQL", "Redis", "pgvector", "MongoDB"],
            "Tools": ["Docker", "pytest", "Git"], "Soft Skills": ["Mentoring", "Teamwork", "Ownership"]}
    out, _ = _enrich(full, floor_total=16)
    assert {k: set(v) for k, v in out.items()} == {k: set(v) for k, v in full.items()}


def test_experience_text_contributes_only_known_technologies():
    evidence = se.build_candidate_evidence([], [], [
        {"role": "Dev", "organization": "Y", "bullet_points": ["Built Node.js APIs backed by MongoDB, go-to-market plans, and express interest in PyTorch"]}
    ])
    names = {s["name"] for s in se.collect_evidence_skills(evidence)}
    assert {"Node.js", "MongoDB", "PyTorch"} <= names
    assert not {"Go", "Express"} & names  # ambiguous words in prose are not read as skills


@pytest.mark.parametrize("category,family,expected", [
    ("building tailored things", "ai", False), ("AI & Machine Learning", "ai", True),
    ("Programming Languages", "languages", True), ("Quick UI Design", "frontend", True),
    ("Building Blocks", "frontend", False), ("Backend & APIs", "backend", True),
])
def test_category_hints_match_whole_words(category, family, expected):
    assert se._has_hint(category, family) is expected


# ── The node: proper mode gets the same floor ────────────────────────────────

@pytest.mark.parametrize("mode", ["proper", "larp", "super_larp"])
async def test_summary_skills_node_fills_a_thin_section_in_every_mode(monkeypatch, mode):
    thin = TailoredSummaryAndSkills(
        summary="Engineer.",
        categories=[{"category": k, "skills": v} for k, v in THIN.items()],
    )
    seen = {}

    async def fake_invoke(chain_factory, args, **kwargs):
        seen.update(args)
        return thin

    monkeypatch.setattr(nodes_mod, "invoke_with_fallback", fake_invoke)
    monkeypatch.setattr(nodes_mod, "log_progress", AsyncMock(return_value=None))
    monkeypatch.setattr(nodes_mod, "get_prompt_config", AsyncMock(return_value=("sys", "{job_analysis}{candidate_skills}{candidate_summary}")))
    state = {
        "creativity_mode": mode,
        "profile": {"skills": ["React", "Python", "Agentic AI"], "summary": "x"},
        "projects": PROJECTS[:2], "experiences": EXPERIENCES,
        "candidate_evidence": se.build_candidate_evidence(["React", "Python", "Agentic AI"], PROJECTS, EXPERIENCES),
        "job_analysis": {"extracted_skills": JOB, "key_requirements": []},
        "keywords": [], "template_manifest": {"id": "personal-classic", "max_skills_categories": 6},
    }
    out = await nodes_mod.summary_skills_node(state, db=AsyncMock(), gen_id="g")
    skills = out["summary_draft"]["skills"]
    assert sum(len(v) for v in skills.values()) >= 16
    assert "FastAPI" in _flat(skills) and "Docker" in _flat(skills)
    # the model is shown the evidence, not just the three profile skills
    assert "Project clean-transactions: Python, FastAPI" in seen["candidate_skills"]


async def test_professional_sans_budget_still_wins(monkeypatch):
    thin = TailoredSummaryAndSkills(summary="x", categories=[{"category": k, "skills": v} for k, v in THIN.items()])
    monkeypatch.setattr(nodes_mod, "invoke_with_fallback", AsyncMock(return_value=thin))
    monkeypatch.setattr(nodes_mod, "log_progress", AsyncMock(return_value=None))
    monkeypatch.setattr(nodes_mod, "get_prompt_config", AsyncMock(return_value=("sys", "{job_analysis}{candidate_skills}{candidate_summary}")))
    state = {
        "creativity_mode": "proper", "profile": {"skills": ["Python"]}, "projects": PROJECTS, "experiences": EXPERIENCES,
        "job_analysis": {"extracted_skills": JOB}, "keywords": [],
        "template_manifest": {"id": "professional-sans", "max_skills_categories": 4},
    }
    skills = (await nodes_mod.summary_skills_node(state, db=AsyncMock(), gen_id="g"))["summary_draft"]["skills"]
    assert len(skills) <= 4 and sum(len(v) for v in skills.values()) <= 20
    assert sum(len(s) for v in skills.values() for s in v) <= 320


async def test_selection_keeps_the_full_evidence_even_though_it_narrows_projects(monkeypatch):
    from src.schemas.pipeline import SelectedItems

    monkeypatch.setattr(nodes_mod, "log_progress", AsyncMock(return_value=None))
    monkeypatch.setattr(nodes_mod, "get_prompt_config", AsyncMock(return_value=("sys {max_exp} {max_proj}", "{job_title} {job_analysis} {experiences} {projects}")))
    monkeypatch.setattr(nodes_mod, "invoke_with_fallback", AsyncMock(return_value=SelectedItems(selected_experience_indices=[0], selected_project_indices=[0, 1])))
    state = {"profile": {"skills": ["Python"]}, "projects": PROJECTS, "experiences": EXPERIENCES,
             "job_analysis": {"job_title": "x", "extracted_skills": []}, "content_split": {"experience": 1, "projects": 2}}
    out = await nodes_mod.selection_node(state, db=AsyncMock(), gen_id="g")
    assert len(out["projects"]) == 2
    assert len(out["candidate_evidence"]["projects"]) == len(PROJECTS)  # nothing lost for the skills step


# ── Template alignment ───────────────────────────────────────────────────────

@pytest.mark.parametrize("template", ["personal-classic", "professional-sans"])
def test_skills_rows_are_left_aligned_even_when_the_body_is_justified(template):
    css = (Path(nodes_mod.settings.TEMPLATES_DIR) / template / "style.css").read_text()
    rule = re.search(r"\.skills-table td\s*\{([^}]*)\}", css)
    assert rule and "text-align: left" in rule.group(1), template


# ── Ranking: who wins when there is not room for everything ──────────────────

def _evidence(projects, profile=()):
    return se.build_candidate_evidence(list(profile), projects, [])


def test_a_job_relevant_skill_beats_a_more_frequent_irrelevant_one_when_space_is_tight():
    projects = [
        {"name": "A", "technologies": ["Tailwind CSS", "Vite", "Docker"]},
        {"name": "B", "technologies": ["Tailwind CSS", "Vite"]},
        {"name": "C", "technologies": ["Tailwind CSS", "Vite"]},
    ]
    found = se.collect_evidence_skills(_evidence(projects), ["A", "B", "C"])
    # Tailwind and Vite appear in 3 projects each, Docker in one, but only Docker is asked for.
    out = se.enrich_skills({"Frontend": ["React"], "Soft Skills": ["Teamwork"]}, found, ["Docker"], floor_total=2, max_total=3)
    assert "Docker" in _flat(out), out


def test_skills_from_projects_shown_on_the_resume_beat_skills_from_hidden_projects():
    projects = [  # hidden first, so position alone cannot make the shown one win
        {"name": "Hidden", "technologies": ["MongoDB"]},
        {"name": "Shown", "technologies": ["Redis"]},
    ]
    found = se.collect_evidence_skills(_evidence(projects), selected_project_names=["Shown"])
    out = se.enrich_skills({"Databases": ["PostgreSQL"], "Soft Skills": ["Teamwork"]}, found, [], floor_total=3, max_total=3)
    assert "Redis" in _flat(out) and "MongoDB" not in _flat(out), out


def test_frequency_breaks_ties_between_equally_relevant_skills():
    projects = [
        {"name": "A", "technologies": ["Redis", "MongoDB"]},
        {"name": "B", "technologies": ["MongoDB"]},
    ]
    found = se.collect_evidence_skills(_evidence(projects), [])
    out = se.enrich_skills({"Databases": ["PostgreSQL"], "Soft Skills": ["Teamwork"]}, found, [], floor_total=3, max_total=3)
    assert "MongoDB" in _flat(out) and "Redis" not in _flat(out), out
