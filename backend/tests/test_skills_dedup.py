"""Regression test: LLM returning both `categories` (&) and `skills` (And) must not duplicate."""

from src.core.skill_categories import skill_category_key
from src.schemas.pipeline import TailoredSummaryAndSkills
from src.pipeline.nodes import _clean_skill_category, _normalize_skills


def _dual_payload():
    return {
        "summary": "Test summary.",
        "categories": [
            {"category": "Languages & Backend", "skills": ["Java", "Python"]},
            {"category": "Testing & QA", "skills": ["Unit Testing"]},
            {"category": "DevOps & Cloud", "skills": ["Docker"]},
            {"category": "Architecture & Data", "skills": ["REST APIs"]},
            {"category": "Soft Skills", "skills": ["Agile"]},
        ],
        "skills": {
            "Languages And Backend": ["Java", "Python"],
            "Testing And QA": ["Unit Testing"],
            "DevOps And Cloud": ["Docker"],
            "Architecture And Data": ["REST APIs"],
            "Soft Skills": ["Agile"],
        },
    }


def test_schema_merges_ampersand_variants_without_duplication():
    obj = TailoredSummaryAndSkills.model_validate(_dual_payload())
    skills = obj.model_dump()["skills"]
    # 5 canonical categories, not 9 duplicated rows
    assert len(skills) == 5, f"duplicated skills categories: {list(skills)}"


def test_clean_skill_category_canonicalizes_ampersand():
    assert _clean_skill_category("Languages And Backend") == _clean_skill_category("Languages & Backend")
    assert _clean_skill_category("Testing And QA") == _clean_skill_category("Testing & QA")


def test_normalize_skills_merges_ampersand_variants():
    merged = _normalize_skills(
        {"Languages & Backend": ["Java"], "Languages And Backend": ["Python"]}
    )
    assert len(merged) == 1
    assert sorted(next(iter(merged.values()))) == ["Java", "Python"]


def test_schema_merges_comma_variants_without_duplication():
    payload = {
        "summary": "Test summary.",
        "categories": [
            {"category": "Cloud, MLOps & Infrastructure", "skills": ["AWS", "Docker"]},
            {"category": "Soft Skills", "skills": ["Agile"]},
        ],
        "skills": {
            "Cloud MLOps And Infrastructure": ["AWS", "Docker"],
            "Soft Skills": ["Agile"],
        },
    }
    obj = TailoredSummaryAndSkills.model_validate(payload)
    skills = obj.model_dump()["skills"]
    assert len(skills) == 2, f"duplicated skills categories: {list(skills)}"


def test_clean_skill_category_canonicalizes_commas():
    assert _clean_skill_category("Cloud MLOps And Infrastructure") == _clean_skill_category(
        "Cloud, MLOps & Infrastructure"
    )


# ── Production failures (gen dc885992, 2026-09-09) ──────────────────────────


def test_schema_ignores_drifting_legacy_skills_dict():
    """Model emitted `categories` as "Languages & Backend" but the legacy
    `skills` dict as "Programming Backend" — merging both duplicated sections."""
    payload = {
        "summary": "Test summary.",
        "categories": [
            {"category": "Languages & Backend", "skills": ["Python", "Go"]},
            {"category": "Soft Skills", "skills": ["Agile"]},
        ],
        "skills": {
            "Programming Backend": ["Python", "Django"],
            "AI & ML": ["vLLM"],
        },
    }
    obj = TailoredSummaryAndSkills.model_validate(payload)
    skills = obj.model_dump()["skills"]
    assert list(skills) == ["Languages & Backend", "Soft Skills"], list(skills)


def test_schema_falls_back_to_skills_when_categories_missing():
    payload = {
        "summary": "Test summary.",
        "skills": {
            "Programming & Backend": ["Python"],
            "Programming Backend": ["Django", "python"],
        },
    }
    obj = TailoredSummaryAndSkills.model_validate(payload)
    skills = obj.model_dump()["skills"]
    assert list(skills) == ["Programming & Backend"]
    assert skills["Programming & Backend"] == ["Python", "Django"]


def test_normalize_skills_merges_missing_ampersand():
    merged = _normalize_skills(
        {"Programming & Backend": ["Python"], "Programming Backend": ["Django"]}
    )
    assert len(merged) == 1
    assert sorted(next(iter(merged.values()))) == ["Django", "Python"]


def test_normalize_skills_merges_fuzzy_variants():
    merged = _normalize_skills(
        {"Cloud & Infrastructure": ["AWS", "GCP"], "Data & Cloud Infrastructure": ["Docker"]}
    )
    assert len(merged) == 1
    assert sorted(next(iter(merged.values()))) == ["AWS", "Docker", "GCP"]


def test_normalize_skills_dedupes_items_case_insensitively():
    merged = _normalize_skills({"Languages": ["Python", "python", "PYTHON"], "languages": ["Java"]})
    assert len(merged) == 1
    assert merged["Languages"] == ["Python", "Java"]


def test_merge_key_expands_abbreviations():
    assert skill_category_key("AI & ML") == skill_category_key("AI & Machine Learning")
    assert skill_category_key("Programming & Backend") == skill_category_key("Programming Backend")
    # "Android" must not be treated as containing "and"
    assert skill_category_key("Android Development") != skill_category_key("AI Development")


def test_merge_keeps_distinct_categories():
    merged = _normalize_skills(
        {"Frontend": ["React"], "Backend": ["FastAPI"], "Data & Observability": ["Grafana"]}
    )
    assert len(merged) == 3
