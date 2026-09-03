"""Regression test: LLM returning both `categories` (&) and `skills` (And) must not duplicate."""

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
