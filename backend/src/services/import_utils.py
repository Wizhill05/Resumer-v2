import re
from difflib import SequenceMatcher


def normalize_text(value: str | None) -> str:
    if not value:
        return ""
    normalized = re.sub(r"[^a-z0-9]+", " ", str(value).lower()).strip()
    return re.sub(r"\s+", " ", normalized)


def similar(a: str | None, b: str | None) -> float:
    left = normalize_text(a)
    right = normalize_text(b)
    if not left or not right:
        return 0.0
    return SequenceMatcher(None, left, right).ratio()


def token_similarity(a: str | None, b: str | None) -> float:
    tokens_a = set(normalize_text(a).split())
    tokens_b = set(normalize_text(b).split())
    if not tokens_a or not tokens_b:
        return 0.0
    intersection = tokens_a & tokens_b
    union = tokens_a | tokens_b
    jaccard = len(intersection) / len(union)
    overlap_min = len(intersection) / min(len(tokens_a), len(tokens_b))
    return max(jaccard, overlap_min * 0.90)


DEGREE_LEVELS = [
    ("phd", {"phd", "ph d", "doctorate", "doctor of philosophy"}),
    ("master", {"master", "masters", "ms", "m s", "mtech", "m tech", "msc", "m sc", "mba", "meng"}),
    ("bachelor", {"bachelor", "bachelors", "bs", "b s", "btech", "b tech", "bsc", "b sc", "be", "b e", "ba", "b a"}),
    ("highschool", {"high school", "secondary", "diploma", "12th", "10th"}),
]


def _get_degree_level(degree: str | None) -> str | None:
    if not degree:
        return None
    norm = normalize_text(degree)
    for level, keywords in DEGREE_LEVELS:
        for kw in keywords:
            if re.search(r"\b" + re.escape(kw) + r"\b", norm):
                return level
    return None


def education_similarity(d1: str | None, i1: str | None, d2: str | None, i2: str | None) -> float:
    lvl1 = _get_degree_level(d1)
    lvl2 = _get_degree_level(d2)
    # If both have distinct identified levels (e.g. bachelor vs master), they are distinct degrees
    if lvl1 and lvl2 and lvl1 != lvl2:
        return 0.0

    full1 = f"{d1 or ''} {i1 or ''}"
    full2 = f"{d2 or ''} {i2 or ''}"
    comp_sim = max(similar(full1, full2), token_similarity(full1, full2))

    inst_sim = max(similar(i1, i2), token_similarity(i1, i2))
    deg_sim = max(similar(d1, d2), token_similarity(d1, d2))

    if inst_sim >= 0.78:
        if lvl1 and lvl2 and lvl1 == lvl2:
            return max(0.85, (inst_sim + deg_sim) / 2)
        if deg_sim >= 0.65 or not d1 or not d2:
            return max(0.85, (inst_sim + deg_sim) / 2)

    return max(comp_sim, (inst_sim + deg_sim) / 2)


def extracurricular_similarity(
    t1: str | None,
    o1: str | None,
    b1: list[str] | str | None,
    t2: str | None,
    o2: str | None,
    b2: list[str] | str | None,
) -> float:
    full1 = f"{t1 or ''} {o1 or ''}"
    full2 = f"{t2 or ''} {o2 or ''}"
    seq_sim = similar(full1, full2)
    tok_sim = token_similarity(full1, full2)
    title_sim = max(similar(t1, t2), token_similarity(t1, t2))

    bullets1 = " ".join(b1) if isinstance(b1, list) else (b1 or "")
    bullets2 = " ".join(b2) if isinstance(b2, list) else (b2 or "")
    bullet_seq_sim = similar(bullets1, bullets2)
    bullet_tok_sim = token_similarity(bullets1, bullets2)
    bullet_score = max(bullet_seq_sim, bullet_tok_sim)

    # If bullet points share substantial content (>= 0.55) and titles/orgs overlap keywords (>= 0.35)
    if bullet_score >= 0.55 and (tok_sim >= 0.35 or title_sim >= 0.35):
        return max(0.85, bullet_score)

    # High title/org composite match
    if tok_sim >= 0.70 or seq_sim >= 0.75:
        return max(seq_sim, tok_sim)

    return max(seq_sim, tok_sim, (title_sim + (similar(o1, o2) if o1 and o2 else 0.5)) / 2)


def unique_strings(values: list[str] | None) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values or []:
        cleaned = str(value).strip()
        key = normalize_text(cleaned)
        if cleaned and key not in seen:
            seen.add(key)
            result.append(cleaned)
    return result
