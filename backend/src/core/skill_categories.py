"""Shared skill-category canonicalization and merging.

Single source of truth used by the LLM structured-output schemas
(src/schemas/pipeline.py) and the pipeline nodes (src/pipeline/nodes.py)
so the two normalization layers can never drift apart again.

The failure this prevents: the LLM emits both `categories` and a legacy
`skills` dict whose category names drift ("Programming & Backend" vs
"Programming Backend", "AI & ML" vs "AI & Machine Learning"), producing
duplicate sections in the final resume.
"""
import re
from difflib import SequenceMatcher

from typing import Any, Iterable

# Abbreviation tokens the LLM spells inconsistently ("AI & ML" vs
# "AI & Machine Learning"). Expanded when computing merge keys only;
# display names are left untouched.
_ABBREVIATIONS = {
    "ml": "machine learning",
    "ai": "artificial intelligence",
    "js": "javascript",
    "ts": "typescript",
    "db": "database",
    "k8s": "kubernetes",
}

# Standalone "and" (not inside another word) so "Android" is never touched.
_STANDALONE_AND = r"(?i)(?<=\s)and(?=\s)|^(and)(?=\s)|(?<=\s)(and)$"

# Similarity above which two canonical keys are treated as the same category
# (e.g. "Front End" vs "Frontend", "Cloud Infrastructure" vs
# "Data & Cloud Infrastructure"). Conservative on purpose.
_FUZZY_THRESHOLD = 0.82


def _clean_text(name: Any) -> str:
    """Lower-level cleanup: separators (`_`, `-`, `,`) become spaces."""
    text = re.sub(r"[_\-,]+", " ", str(name or "")).strip()
    return re.sub(r"\s+", " ", text)


def skill_category_display(name: Any) -> str:
    """Clean display name: canonical `&`, Title Case, keeps ACRONYMS and A/B forms."""
    text = _clean_text(name)
    text = re.sub(_STANDALONE_AND, "&", text)
    text = re.sub(r"\s*&\s*", " & ", text)
    text = re.sub(r"\s+", " ", text).strip()
    words = []
    for word in text.split(" "):
        if word == "&" or word.isupper() or "/" in word:
            words.append(word)
        else:
            words.append(word[:1].upper() + word[1:])
    return " ".join(words)


def skill_category_key(name: Any) -> str:
    """Canonical merge key: case-insensitive, separators/`&`/standalone `and`
    collapsed, common abbreviations expanded.

    "Programming & Backend", "Programming And Backend" and "Programming
    Backend" all map to "programming backend"; "AI & ML" and "AI & Machine
    Learning" both map to "ai artificial intelligence machine learning".
    """
    text = _clean_text(name).lower()
    text = re.sub(_STANDALONE_AND, " ", text)
    text = text.replace("&", " ")
    tokens = [_ABBREVIATIONS.get(t, t) for t in text.split(" ") if t]
    return " ".join(tokens)


def merge_skill_items(existing: list[str], new_items: list[str]) -> list[str]:
    """Merge item lists case-insensitively, keeping the first spelling."""
    merged = list(existing)
    seen = {str(i).casefold() for i in existing}
    for item in new_items:
        folded = str(item).casefold()
        if folded not in seen:
            seen.add(folded)
            merged.append(item)
    return merged


def merge_skill_categories(raw: Any) -> dict[str, list[str]]:
    """Merge `{name: items}` (dict, or iterable of (name, items) pairs) into a
    single deduplicated dict keyed by display name.

    Categories collide — and merge — when they share a canonical key or are
    near-identical strings. The first spelling seen wins for both the display
    name and item casing, keeping output stable across runs.
    """
    pairs: Iterable[tuple[Any, Any]]
    pairs = raw.items() if isinstance(raw, dict) else raw

    merged: dict[str, list[str]] = {}
    display: dict[str, str] = {}
    order: list[str] = []

    for name, items in pairs:
        key = skill_category_key(name)
        clean_items = [str(i).strip() for i in (items or []) if str(i).strip()]
        if not key or not clean_items:
            continue
        if key not in merged:
            near = _near_duplicate_key(key, merged)
            if near is not None:
                key = near
        if key not in merged:
            merged[key] = []
            display[key] = skill_category_display(name) or "General"
            order.append(key)
        merged[key] = merge_skill_items(merged[key], clean_items)

    return {display[k]: merged[k] for k in order}


def _near_duplicate_key(key: str, existing: dict[str, list[str]]) -> str | None:
    """Return the existing key most similar to `key` (>= threshold), else None."""
    best, best_ratio = None, 0.0
    for other in existing:
        ratio = SequenceMatcher(None, key, other).ratio()
        if ratio >= _FUZZY_THRESHOLD and ratio > best_ratio:
            best, best_ratio = other, ratio
    return best
