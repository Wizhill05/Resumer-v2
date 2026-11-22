"""Own-model drafting with real WeasyPrint renders: measured issues, staging, scoring, finalize.

Evaluations are cached per module (each one is a font-fit binary search, a few seconds).
"""

import copy
import json
import re
from functools import lru_cache

import pytest

from src.services import client_draft as cd
from src.services import resume_render
from tests.client_draft_fixtures import (
    BACKEND_DIR,
    BULLET_BANK,
    EXTRA_BANK,
    brief_draft,
    brief_inputs,
    cut_to,
    full_draft,
    huge_draft,
    make_draft,
    thin_draft,
)

PS, PC = "professional-sans", "personal-classic"


@lru_cache(maxsize=None)
def _snapshot_json(template, mode="larp", split=None, profile="rich"):
    split_d = dict(split) if split else None
    return json.dumps(cd.build_client_brief(**brief_inputs(profile, template, mode=mode, split=split_d))["snapshot"])


def snap(template, mode="larp", split=None, profile="rich"):
    return json.loads(_snapshot_json(template, mode, tuple(sorted(split.items())) if split else None, profile))


def evaluate(snapshot, draft, submissions=1, attempts=None):
    return cd.evaluate_draft(snapshot=snapshot, client_draft=draft, submissions=submissions, attempts=attempts or {})


def kinds(ev, severity=None):
    return [i["kind"] for i in ev.issues if severity is None or i["severity"] == severity]


@pytest.fixture(scope="module")
def ps_full():
    s = snap(PS)
    return s, evaluate(s, full_draft(s))


@pytest.fixture(scope="module")
def pc_full():
    s = snap(PC)
    return s, evaluate(s, full_draft(s))


@pytest.fixture(scope="module")
def pc_thin():
    s = snap(PC)
    return s, evaluate(s, thin_draft(s))


@pytest.fixture(scope="module")
def pc_huge():
    s = snap(PC, split={"experience": 3, "projects": 3})
    return s, evaluate(s, huge_draft(s))


def _with_bullet(snapshot, base_ev, path, text):
    new, errors = cd.apply_revisions(base_ev.client_draft, [{"path": path, "text": text}])
    assert not errors
    return new


# ── Page fill and the full/thin/huge triad ────────────────────────────────────


def test_full_draft_fills_the_page_and_is_not_underfilled(ps_full, pc_full):
    for s, ev in (ps_full, pc_full):
        assert ev.layout["fits_target"] is True and ev.layout["page_count"] == 1
        assert ev.layout["page_fill_percent"] >= cd.PAGE_FILL_TARGET * 100
        assert "underfilled_page" not in kinds(ev)
        assert ev.layout["measurement_error"] is None
    # the professional-sans full draft is clean on the first try (calibrated window)
    s, ev = ps_full
    assert ev.status == "ready" and kinds(ev, "blocking") == []


def test_thin_draft_is_underfilled_with_concrete_additions(pc_thin):
    s, ev = pc_thin
    assert ev.status == "needs_revision"
    assert ev.layout["font_size"] == s["manifest"]["max_font_size"]
    assert ev.layout["page_fill_percent"] < cd.PAGE_FILL_TARGET * 100
    under = next(i for i in ev.issues if i["kind"] == "underfilled_page")
    assert under["severity"] == "blocking" and under["free_lines"] >= 5
    paths = [a.get("path") for a in under["suggested_additions"]]
    assert "experiences[0].bullet_points" in paths  # entries below their max bullet count
    assert any(a.get("source_id") == "extra_1" for a in under["suggested_additions"])  # unused extracurricular
    assert "summary" in paths
    text = under["instruction"]
    assert re.search(r"only \d+% full", text) and re.search(r"about \d+ lines are free", text)
    assert text.index("add a bullet") < text.index("extracurricular") < text.index("summary")
    # every suggestion is expressible with the revision API
    revs = [
        {"op": "append", "path": "experiences[0].bullet_points", "text": "x"},
        {"op": "append", "path": "extracurriculars", "source_id": "extra_1", "text": "y"},
    ]
    assert cd.apply_revisions(ev.client_draft, revs)[1] == []


def test_underfill_stops_blocking_late_and_without_structural_room(pc_thin):
    s, ev = pc_thin
    late = evaluate(s, ev.client_draft, submissions=cd.UNDERFILL_BLOCKING_BEFORE_SUBMISSION)
    under = next(i for i in late.issues if i["kind"] == "underfilled_page")
    assert under["severity"] == "advisory"
    assert late.status == "ready"
    # same draft, same measurements -> same measured terms; only the blocking count differs, and the
    # ready evaluation ranks above the one where underfill was still blocking
    assert late.score[0] == ev.score[0] and late.score[2:] == ev.score[2:]
    assert late.score > ev.score


def test_huge_draft_overflows_with_cheapest_cuts(pc_huge):
    s, ev = pc_huge
    assert ev.layout["fits_target"] is False and ev.layout["page_count"] >= 2
    assert ev.layout["font_size"] == s["manifest"]["min_font_size"]
    overflow = ev.issues[0]
    assert overflow["kind"] == "page_overflow" and overflow["severity"] == "blocking"
    assert overflow["lines_over"] >= 1
    assert overflow["suggested_cuts"] and all(c["op"] in ("remove", "set") for c in overflow["suggested_cuts"])
    assert re.search(r"about \d+ lines? too long", overflow["instruction"])
    # stage 1 only: no orphan/underfill feedback while the page does not fit
    assert ev.layout["feedback_stage"] == 1
    assert not {"orphan", "underfilled_page"} & set(kinds(ev, "blocking"))
    removes = [{"op": "remove", "path": c["path"]} for c in overflow["suggested_cuts"] if c["op"] == "remove"]
    if removes:
        assert cd.apply_revisions(ev.client_draft, removes)[1] == []


def test_page_fill_score_orders_full_over_thin_over_overflow(ps_full, pc_thin, pc_huge):
    full, thin, huge = ps_full[1], pc_thin[1], pc_huge[1]
    assert full.score > thin.score > huge.score
    assert json.loads(json.dumps(full.score)) == full.score  # JSON-serialisable


# ── Bullet-level issues ───────────────────────────────────────────────────────


def test_orphan_issue_carries_a_measured_window(ps_full):
    s, base = ps_full
    short = cut_to(BULLET_BANK[3], 125)
    ev = evaluate(s, _with_bullet(s, base, "experiences[0].bullet_points[1]", short))
    orphan = next(i for i in ev.issues if i["kind"] == "orphan")
    assert orphan["path"] == "experiences[0].bullet_points[1]" and orphan["severity"] == "blocking"
    assert orphan["rendered_lines"] == 2 and orphan["last_line_fill_percent"] < 80
    tc = orphan["target_chars"]
    assert tc["min"] <= tc["aim"] <= tc["max"] and tc["min"] > orphan["visible_chars"]
    assert f"between {tc['min']} and {tc['max']} visible characters" in orphan["instruction"]
    assert "Do not shorten it to one line" in orphan["instruction"]
    assert ev.layout["feedback_stage"] == 3

    # following the instruction (aim) fixes it
    fixed = cut_to(short + " " + BULLET_BANK[3].split(" ", 20)[-1], tc["aim"])
    fixed = cut_to(BULLET_BANK[3], tc["aim"]) if len(fixed.replace("**", "")) < tc["min"] else fixed
    again = evaluate(s, _with_bullet(s, base, "experiences[0].bullet_points[1]", fixed), submissions=2, attempts=ev.attempts)
    assert "experiences[0].bullet_points[1]" not in [i.get("path") for i in again.issues if i["kind"] == "orphan"]


def test_oversize_is_detected_and_staged_before_orphans(ps_full):
    s, base = ps_full
    long = cut_to(BULLET_BANK[0] + " " + BULLET_BANK[1], 245)
    short = cut_to(BULLET_BANK[5], 125)
    draft, errors = cd.apply_revisions(base.client_draft, [
        {"path": "projects[0].bullet_points[0]", "text": long},
        {"path": "experiences[1].bullet_points[0]", "text": short},
    ])
    assert not errors
    ev = evaluate(s, draft)
    over = next(i for i in ev.issues if i["kind"] == "oversize")
    assert over["path"] == "projects[0].bullet_points[0]" and over["rendered_lines"] >= 3
    assert over["target_chars"]["max"] < over["visible_chars"]
    assert "renders on 3 lines" in over["instruction"]
    # F2: cutting the 3-line bullet cannot move the font here (the page stays full), so the orphan's
    # measured window stays valid and both come back in the same round
    assert ev.layout["font_stable"] is True
    orphan = next(i for i in ev.issues if i["kind"] == "orphan")
    assert orphan["path"] == "experiences[1].bullet_points[0]" and orphan["target_chars"]["min"] > orphan["visible_chars"]
    assert ev.more_issues == 0 and not ev.upcoming


def test_orphans_wait_behind_a_page_overflow_but_carry_their_windows(pc_huge):
    """B1 anti-oscillation is kept for page overflow: cuts there can change the font. The withheld
    bullet issues still carry their measured windows (F2)."""
    s, ev = pc_huge
    assert ev.layout["feedback_stage"] == 1 and ev.layout["font_stable"] is False
    assert "page_overflow" in kinds(ev, "blocking")
    assert not {"orphan", "underfilled_page"} & set(kinds(ev, "blocking"))
    for item in ev.upcoming:
        if item["kind"] in ("orphan", "oversize"):
            assert {"visible_chars", "target_chars", "measured_at_font"} <= set(item), item


def test_attempt_memory_is_quoted_in_the_next_instruction(ps_full):
    s, base = ps_full
    draft = _with_bullet(s, base, "experiences[0].bullet_points[1]", cut_to(BULLET_BANK[3], 125))
    first = evaluate(s, draft)
    path = "experiences[0].bullet_points[1]"
    assert first.attempts[path]["kind"] == "orphan" and first.attempts[path]["lines"] == 2
    draft2 = _with_bullet(s, base, path, cut_to(BULLET_BANK[3], 140))
    second = evaluate(s, draft2, submissions=2, attempts=first.attempts)
    issue = next(i for i in second.issues if i.get("path") == path)
    prev = first.attempts[path]["chars"]
    now = len(cut_to(BULLET_BANK[3], 140).replace("**", ""))
    assert f"Your previous submission of this text was {prev} characters, 2 rendered lines; this one is {now}" in issue["instruction"]
    assert second.attempts[path]["history"] == ["orphan", "orphan"]
    assert second.attempts[path]["chars"] == now == issue["visible_chars"]  # A7: memory = text submitted
    # unchanged text is reported as unchanged (not as a "previous attempt" of a different length)
    third = evaluate(s, draft2, submissions=3, attempts=second.attempts)
    issue3 = next(i for i in third.issues if i.get("path") == path)
    assert f"This text is unchanged since your previous submission ({now} characters" in issue3["instruction"]
    # the entries moved (another source_id at this path): the memory is about another bullet, so it is dropped
    moved = copy.deepcopy(second.attempts)
    moved[path]["source_id"] = "exp_9"
    issue4 = next(i for i in evaluate(s, draft2, submissions=3, attempts=moved).issues if i.get("path") == path)
    assert "previous submission" not in issue4["instruction"]


def test_oscillating_bullet_becomes_advisory_orphan_unfixable(ps_full):
    s, base = ps_full
    path = "experiences[0].bullet_points[1]"
    draft = _with_bullet(s, base, path, cut_to(BULLET_BANK[3], 125))
    attempts = {path: {"chars": 200, "lines": 3, "fill": None, "kind": "oversize", "history": ["orphan", "oversize"]}}
    ev = evaluate(s, draft, submissions=3, attempts=attempts)
    issue = next(i for i in ev.issues if i.get("path") == path)
    assert issue["kind"] == "orphan_unfixable" and issue["severity"] == "advisory"
    assert path not in [i.get("path") for i in ev.issues if i["severity"] == "blocking"]


def test_issue_list_is_capped_and_counts_the_rest():
    s = snap(PC)
    ev = evaluate(s, make_draft(s, bullet_chars=120, extra_chars=130))  # ~1.2 lines each: many orphans
    assert ev.layout["feedback_stage"] == 3
    assert len(ev.issues) <= cd.MAX_ISSUES_PER_RESPONSE
    assert ev.layout["blocking_total"] > cd.MAX_ISSUES_PER_RESPONSE
    shown_blocking = sum(1 for i in ev.issues if i["severity"] == "blocking")
    assert ev.more_issues >= ev.layout["blocking_total"] - shown_blocking > 0


def test_proper_mode_advisories_never_block():
    s = snap(PS, mode="proper")
    draft = full_draft(s)
    draft["skills"]["Languages"] = ["Python", "SQL", "Haskell"]
    ev = evaluate(s, draft)
    adv = {i["kind"]: i for i in ev.issues if i["severity"] == "advisory"}
    assert "unsupported_metric" in adv and adv["unsupported_metric"]["details"]
    assert adv["unsupported_skill"]["skills"] == ["Haskell"]
    assert ev.status == "ready"


def test_invalid_draft_is_not_rendered(monkeypatch):
    s = snap(PC)
    monkeypatch.setattr(cd, "render_fitted_document", lambda **k: pytest.fail("rendered an invalid draft"))
    ev = evaluate(s, {"summary": "", "experiences": []})
    assert ev.status == "invalid_draft" and ev.errors and ev.client_draft is None


@pytest.mark.parametrize("target", ["render_fitted_document", "detect_orphans_in_weasyprint"])
def test_measurement_errors_are_explicit_never_clean(monkeypatch, target):
    s = snap(PS)

    def boom(*a, **k):
        raise RuntimeError("layout engine exploded")

    monkeypatch.setattr(cd, target, boom)
    ev = evaluate(s, full_draft(s))
    assert ev.status == "needs_revision"
    assert "layout engine exploded" in ev.layout["measurement_error"]
    assert kinds(ev) == ["measurement_error"]
    assert ev.score == cd._score(None, 0, 0) and ev.client_draft is not None


# ── Convergence with an instruction-following client ─────────────────────────


def _follow(ev):
    """A deterministic 'client model' that does exactly what each blocking instruction says."""
    revs = []
    for k, issue in enumerate(i for i in ev.issues if i["severity"] == "blocking"):
        if issue["kind"] in ("orphan", "oversize"):
            aim = issue["target_chars"]["aim"]
            words = issue["text"].split(" ")
            pool = (BULLET_BANK[(k + 7) % len(BULLET_BANK)]).split(" ")
            while len(" ".join(words).replace("**", "")) < aim and pool:
                words.append(pool.pop())
            revs.append({"path": issue["path"], "text": cut_to(" ".join(words), aim)})
        elif issue["kind"] == "underfilled_page":
            for a in issue["suggested_additions"]:
                if a.get("path", "").endswith(".bullet_points"):
                    revs.append({"op": "append", "path": a["path"], "text": cut_to(BULLET_BANK[len(revs) % 12], 186)})
                elif a.get("source_id"):
                    revs.append({"op": "append", "path": "extracurriculars", "source_id": a["source_id"],
                                 "text": cut_to(EXTRA_BANK[len(revs) % 3], 80)})
                elif a.get("path") == "summary":
                    revs.append({"path": "summary", "text": cut_to(" ".join(BULLET_BANK[:2]), 210)})
                elif a.get("lengthen_to_two_lines"):
                    revs.append({"path": a["path"], "text": cut_to(BULLET_BANK[len(revs) % 12], 186)})
    return revs


def test_instruction_following_client_converges_within_four_submissions():
    s = snap(PS)
    draft, attempts = thin_draft(s), {}
    for submission in range(1, 5):
        ev = evaluate(s, draft, submissions=submission, attempts=attempts)
        if ev.status == "ready":
            break
        draft, errors = cd.apply_revisions(ev.client_draft, _follow(ev))
        assert not errors, errors
        attempts = ev.attempts
    assert ev.status == "ready", [i["instruction"] for i in ev.issues]
    assert ev.layout["page_fill_percent"] >= cd.PAGE_FILL_TARGET * 100


# ── Finalize ──────────────────────────────────────────────────────────────────


def test_finalize_trims_a_three_line_bullet_and_measures_the_final_document(ps_full):
    s, base = ps_full
    long = cut_to(BULLET_BANK[0] + " " + BULLET_BANK[1], 245)
    draft = _with_bullet(s, base, "projects[0].bullet_points[0]", long)
    ev = evaluate(s, draft)
    assert "oversize" in kinds(ev)
    fin = cd.finalize_draft(snapshot=s, tailored_resume=ev.tailored_resume, submissions=3,
                            finalized_reason="finalize_flag", client_model="tiny-model")
    assert fin.pdf_bytes.startswith(b"%PDF")
    trimmed = fin.tailored_resume["projects"][0]["bullet_points"][0]
    assert len(trimmed.replace("**", "")) < len(long.replace("**", ""))
    assert ev.tailored_resume["projects"][0]["bullet_points"][0] == long  # input not mutated
    assert fin.quality["oversize_trimmed"] == 1 and fin.quality["oversize_remaining"] == 0
    assert any("Trimmed 1 bullet" in w for w in fin.warnings)

    # the final document really has no 3-line bullet, and page fill is that document's
    doc = resume_render.render_document_at(
        template_id=PS, profile=s["profile"], resume=fin.tailored_resume, font_size=fin.font_size,
        page_margin_mm=s["manifest"]["page_margin_mm"], section_order=s["section_order"],
    )
    assert all(v["lines"] <= 2 for v in resume_render.measure_bullet_lines(doc).values())
    assert fin.page_fill_percent == round(resume_render.measure_page_fill(doc, s["manifest"]["page_margin_mm"]) * 100, 1)
    assert fin.quality["page_fill_percent"] == fin.page_fill_percent


def test_finalize_quality_dict_and_markdown(ps_full):
    s, ev = ps_full
    fin = cd.finalize_draft(snapshot=s, tailored_resume=ev.tailored_resume, submissions=1,
                            finalized_reason="ready", client_model="gpt-x")
    q = fin.quality
    for key in ("submissions", "page_fill_percent", "font_size", "page_count", "fits_target", "orphans_remaining",
                "oversize_trimmed", "underfilled", "advisory_counts", "bullet_chars", "summary_words",
                "skills_total", "client_model", "finalized_reason", "requirements"):
        assert key in q, key
    assert q["client_model"] == "gpt-x" and q["finalized_reason"] == "ready" and q["submissions"] == 1
    assert q["fits_target"] is True and q["underfilled"] is False and q["oversize_trimmed"] == 0
    assert set(q["bullet_chars"]) == {"min", "max", "mean"} and q["bullet_chars"]["max"] <= 205
    assert fin.page_count == 1 and fin.fits_target and fin.warnings == []
    assert fin.markdown.startswith("# Priya Raman") and "Lattice Freight" in fin.markdown
    json.dumps(q)


def test_finalize_records_overflow_as_a_warning(pc_huge):
    s, ev = pc_huge
    fin = cd.finalize_draft(snapshot=s, tailored_resume=ev.tailored_resume, submissions=6,
                            finalized_reason="submission_cap", client_model=None)
    assert fin.fits_target is False and fin.page_count >= 2
    assert any("does not fit" in w for w in fin.warnings)
    assert fin.quality["finalized_reason"] == "submission_cap"


# ── Calibration (grounds PAGE_FILL_TARGET and the char windows in real renders) ─


@pytest.mark.parametrize("template", [PC, PS])
def test_calibration_sample_resume_fills_the_page(template):
    """The sample résumé (a typical full server-style résumé) fills >= 97% of the usable page."""
    sample = json.loads((BACKEND_DIR.parent / "sample-resume" / "dario-altman.json").read_text())
    manifest = json.loads((BACKEND_DIR / "templates" / template / "manifest.json").read_text())
    fitted = resume_render.render_fitted_document(
        template_id=template, profile=sample["profile"], resume=sample["resume"], manifest=manifest,
        section_order=manifest["default_section_order"],
    )
    fill = resume_render.measure_page_fill(fitted.doc, manifest["page_margin_mm"])
    assert fitted.fits_target and fill >= 0.97, (fitted.font_size, fill)
    assert fill >= cd.PAGE_FILL_TARGET


def test_calibration_professional_sans_window_renders_clean_two_line_bullets(ps_full):
    s, ev = ps_full
    window = s["requirements"]["bullet_visible_chars"]
    lengths = [len(b.replace("**", "")) for e in ev.client_draft["experiences"] + ev.client_draft["projects"] for b in e["bullet_points"]]
    assert all(window["target_min"] - 8 <= n <= window["wraps_above"] for n in lengths), lengths
    assert ev.layout["orphans"] == 0 and ev.layout["oversize"] == 0


# ── Review fixes: unspaced scripts, strict finalize, score, executable suggestions ─


# ~200 visible characters of unspaced CJK with bold tools/metrics: no spaces, so word and clause cuts
# cannot shorten it (the reviewer's reproduction: it stayed on 5 lines after finalize).
CJK_BULLET = (
    "使用**Kubernetes**和**Python**重构了货运定价服务的核心计算链路并引入缓存与异步批处理机制将高峰期接口延迟降低了"
    "**83%**同时为合作伙伴保留稳定的公共契约并为每个端点和每个数据版本补充了契约测试与回归测试确保发布过程安全可靠"
    "并且在三个季度内把线上事故数量减少到原来的一半以下让值班工程师能够更快定位问题并恢复服务以及持续改进"
    "并在多个区域部署了自动扩缩容策略以应对节假日流量高峰保障核心业务连续运行"
)


def _all_measured_lines(s, fin):
    doc = resume_render.render_document_at(
        template_id=s["template_id"], profile=s["profile"], resume=fin.tailored_resume, font_size=fin.font_size,
        page_margin_mm=s["manifest"]["page_margin_mm"], section_order=s["section_order"],
    )
    return resume_render.measure_bullet_lines(doc)


def _bold_spans(text):
    return re.findall(r"\*\*(.+?)\*\*", text)


@pytest.mark.parametrize("fixture", ["ps_full", "pc_full"])
def test_finalize_cuts_an_unspaced_cjk_bullet_to_two_verified_lines(fixture, request):
    s, base = request.getfixturevalue(fixture)
    assert 190 <= len(CJK_BULLET.replace("**", "")) <= 215
    path = "experiences[0].bullet_points[0]"
    draft = _with_bullet(s, base, path, CJK_BULLET)
    normalized, errors = cd.normalize_draft(s, draft)
    assert errors == [] and normalized is not None  # a valid draft: CJK runs are breakable
    tailored, _ = cd.merge_draft(s, normalized)
    fin = cd.finalize_draft(snapshot=s, tailored_resume=tailored, submissions=2,
                            finalized_reason="finalize_flag", client_model=None)
    lines = _all_measured_lines(s, fin)
    assert lines and all(v["lines"] <= 2 for v in lines.values()), {k: v["lines"] for k, v in lines.items()}
    out = fin.tailored_resume["experiences"][0]["bullet_points"][0]
    assert 0 < len(out.replace("**", "")) < len(CJK_BULLET.replace("**", ""))
    assert CJK_BULLET.startswith(out.split("**")[0])  # a prefix: cut, not rewritten
    assert out.count("**") % 2 == 0 and set(_bold_spans(out)) <= set(_bold_spans(CJK_BULLET))
    assert fin.quality["oversize_remaining"] == 0 and fin.quality["line_measurement"] == "verified"
    assert fin.quality["oversize_trimmed"] >= 1


def test_finalize_never_publishes_an_unverified_layout(ps_full, monkeypatch):
    """A8: with line measurement failing, finalize raises FinalizeUnverified (no PDF to publish)."""
    s, base = ps_full
    bold_long = cut_to(BULLET_BANK[6] + " " + BULLET_BANK[7], 240)  # valid, bold-heavy, 3+ lines
    draft = _with_bullet(s, base, "experiences[0].bullet_points[0]", bold_long)
    normalized, errors = cd.normalize_draft(s, draft)
    assert errors == []
    tailored, _ = cd.merge_draft(s, normalized)

    def boom(*a, **k):
        raise RuntimeError("line boxes unavailable")

    monkeypatch.setattr(cd, "measure_bullet_lines", boom)
    with pytest.raises(cd.FinalizeUnverified, match="line boxes unavailable"):
        cd.finalize_draft(snapshot=s, tailored_resume=tailored, submissions=2,
                          finalized_reason="finalize_flag", client_model=None)


def test_finalize_retries_a_failed_measurement_on_a_fresh_render(ps_full, monkeypatch):
    s, ev = ps_full
    real = cd.measure_bullet_lines
    calls = {"n": 0}

    def flaky(doc):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("transient")
        return real(doc)

    monkeypatch.setattr(cd, "measure_bullet_lines", flaky)
    fin = cd.finalize_draft(snapshot=s, tailored_resume=ev.tailored_resume, submissions=1,
                            finalized_reason="ready", client_model=None)
    assert calls["n"] == 2 and fin.quality["line_measurement"] == "verified"
    assert fin.pdf_bytes.startswith(b"%PDF") and fin.quality["oversize_remaining"] == 0


def test_finalize_raises_instead_of_returning_remaining_oversize(ps_full, monkeypatch):
    s, base = ps_full
    draft = _with_bullet(s, base, "projects[0].bullet_points[0]", cut_to(BULLET_BANK[0] + " " + BULLET_BANK[1], 245))
    tailored, _ = cd.merge_draft(s, cd.normalize_draft(s, draft)[0])
    real = cd.trim_oversize_bullets

    def stuck(resume, oversize, render, **kw):
        out = real(resume, oversize, render, **kw)
        out.remaining_oversize = list(oversize)
        return out

    monkeypatch.setattr(cd, "trim_oversize_bullets", stuck)
    with pytest.raises(cd.FinalizeUnverified, match="3\\+ lines"):
        cd.finalize_draft(snapshot=s, tailored_resume=tailored, submissions=2,
                          finalized_reason="finalize_flag", client_model=None)


def test_finalize_reads_horizontal_overflow_from_the_final_document(ps_full, monkeypatch):
    """A11: the final document decides; a horizontal overflow alone is not reported as 'does not fit'."""
    s, ev = ps_full
    monkeypatch.setattr(cd, "check_horizontal_overflow", lambda doc, margin=14.0: True)
    fin = cd.finalize_draft(snapshot=s, tailored_resume=ev.tailored_resume, submissions=1,
                            finalized_reason="requested", client_model=None)
    assert fin.has_horizontal_overflow is True and fin.fits_target is False and fin.page_count == 1
    assert any("wider than the page" in w for w in fin.warnings)
    assert not any("does not fit" in w for w in fin.warnings)
    monkeypatch.undo()
    clean = cd.finalize_draft(snapshot=s, tailored_resume=ev.tailored_resume, submissions=1,
                              finalized_reason="ready", client_model=None)
    assert clean.has_horizontal_overflow is False and clean.fits_target is True


def test_a_ready_draft_outranks_an_earlier_draft_with_one_oversize_bullet(ps_full, pc_thin):
    """Reviewer scenario: one 3-line bullet (1 defect) used to outrank a later zero-blocker draft whose
    advisory underfill counted as ~6 defects, so finalize kept the worse draft."""
    s, base = ps_full
    earlier = evaluate(s, _with_bullet(s, base, "projects[0].bullet_points[0]", cut_to(BULLET_BANK[0] + " " + BULLET_BANK[1], 245)))
    assert earlier.status == "needs_revision" and "oversize" in kinds(earlier, "blocking")
    s2, thin = pc_thin
    later = evaluate(s2, thin.client_draft, submissions=cd.UNDERFILL_BLOCKING_BEFORE_SUBMISSION)
    assert later.status == "ready" and "underfilled_page" in kinds(later, "advisory")
    assert later.score[2] < earlier.score[2]  # more measured defects...
    assert later.score > earlier.score  # ...but ready wins
    # and in general: every ready evaluation outranks every evaluation with a blocking issue
    pool = [earlier, later, thin, ps_full[1]]
    for a in pool:
        for b in pool:
            if a.status == "ready" and b.layout.get("blocking_total"):
                assert a.score > b.score


def _revisions_from_suggestion(sugg):
    rev = {k: sugg[k] for k in ("op", "path", "category", "source_id") if k in sugg}
    if rev["path"] == "skills" and rev["op"] == "set":
        rev["items"] = sugg.get("items") or sugg.get("current_items") or ["Python"]
    elif rev["op"] in ("set", "append"):
        rev["text"] = "Shipped **Python** services"
    return rev


def _all_suggestions(ev):
    out = []
    for issue in ev.issues:
        out += issue.get("suggested_cuts") or []
        out += issue.get("suggested_additions") or []
        if issue.get("suggested_fix"):
            out.append(issue["suggested_fix"])
        if issue.get("path"):  # bullet/summary issues: the fix is a rewrite of that path
            out.append({"op": "set", "path": issue["path"]})
        for p in issue.get("paths") or []:
            out.append({"op": "set", "path": p})
        for d in issue.get("details") or []:
            out.append({"op": "set", "path": d["path"]})
    return out


_PLACEHOLDER = re.compile(r"^<[^<>]+>$")


def _fill_placeholder(rev, k):
    """Replace a suggested_revision's placeholder with real text of a plausible length (as a client would)."""
    rev = copy.deepcopy(rev)
    if "items" in rev:
        rev["items"] = [("Docker" if _PLACEHOLDER.match(x) else x) for x in rev["items"]]
    if "text" in rev:
        assert _PLACEHOLDER.match(rev["text"]), rev
        path = rev["path"]
        if path == "summary":
            rev["text"] = "Backend engineer building **Python** services and **PostgreSQL** data models for ML platforms."
        elif path.startswith("extracurriculars"):
            rev["text"] = cut_to(EXTRA_BANK[k % 3], 80)
        elif path.endswith((".description", ".project_summary")):
            rev["text"] = "Feature store for ML teams"
        else:
            m = re.search(r"(\d+)-(\d+) visible", rev["text"]) or re.search(r"at most (\d+)", rev["text"])
            n = int(m.group(1)) + 2 if m else 170
            rev["text"] = cut_to(BULLET_BANK[k % len(BULLET_BANK)], n)
    return rev


def _suggested_revisions(ev):
    out = []
    for issue in ev.issues:
        if issue.get("suggested_revision"):
            out.append(issue["suggested_revision"])
        out += issue.get("suggested_revisions") or []
    return out


@pytest.fixture(scope="module")
def suggestion_evaluations(ps_full, pc_thin, pc_huge):
    s_over = _with_bullet(ps_full[0], ps_full[1], "projects[0].bullet_points[0]", cut_to(BULLET_BANK[0] + " " + BULLET_BANK[1], 245))
    s_orphan = _with_bullet(ps_full[0], ps_full[1], "experiences[0].bullet_points[1]", cut_to(BULLET_BANK[3], 125))
    proper = snap(PS, mode="proper")
    proper_draft = full_draft(proper)
    proper_draft["skills"]["Languages"] = ["Python", "SQL", "Haskell"]
    proper_draft["experiences"][0]["bullet_points"][1] = cut_to(BULLET_BANK[3], 125)
    pc_proper = snap(PC, mode="proper")
    return [
        pc_thin[1], pc_huge[1], evaluate(ps_full[0], s_over), evaluate(ps_full[0], s_orphan),
        evaluate(proper, proper_draft), evaluate(pc_proper, thin_draft(pc_proper)),
    ], [pc_thin[0], pc_huge[0], ps_full[0], ps_full[0], proper, pc_proper]


def test_every_suggested_action_is_accepted_by_apply_revisions(suggestion_evaluations):
    evaluations, _ = suggestion_evaluations
    seen_kinds, seen_ops = set(), set()
    for ev in evaluations:
        assert ev.client_draft is not None
        seen_kinds |= set(kinds(ev))
        for sugg in _all_suggestions(ev):
            assert "op" in sugg and "path" in sugg, sugg
            rev = _revisions_from_suggestion(sugg)
            _, errors = cd.apply_revisions(ev.client_draft, [rev])
            assert errors == [], (sugg, errors)
            seen_ops.add(sugg["op"])
    assert {"page_overflow", "underfilled_page", "oversize", "orphan"} <= seen_kinds
    assert seen_ops == {"set", "append", "remove"}


def test_every_suggested_revision_is_copy_ready(suggestion_evaluations):
    """A14: each actionable issue carries a revision in the exact API shape; with its placeholder
    replaced by real text it passes apply_revisions AND normalize_draft."""
    evaluations, snapshots = suggestion_evaluations
    seen_ops, n = set(), 0
    for ev, s in zip(evaluations, snapshots):
        for issue in ev.issues:
            if issue["kind"] in ("oversize", "orphan", "page_overflow", "underfilled_page", "horizontal_overflow",
                                 "summary_length", "weak_bullet", "unsupported_metric"):
                assert issue.get("suggested_revision") or issue.get("suggested_revisions"), issue["kind"]
        for k, rev in enumerate(_suggested_revisions(ev)):
            filled = _fill_placeholder(rev, k)
            patched, errors = cd.apply_revisions(ev.client_draft, [filled])
            assert errors == [], (rev, errors)
            normalized, errors = cd.normalize_draft(s, patched)
            assert errors == [] and normalized is not None, (rev, errors)
            seen_ops.add(rev["op"])
            n += 1
    assert n >= 10 and seen_ops == {"set", "append", "remove"}
    # an underfill suggestion for a new bullet is an append on the list path, never an index (Luna run)
    thin = evaluations[0]
    under = next(i for i in thin.issues if i["kind"] == "underfilled_page")
    appends = [r for r in under["suggested_revisions"] if r["path"].endswith(".bullet_points")]
    assert appends and all(r["op"] == "append" for r in appends)


def test_horizontal_overflow_points_at_the_token_with_an_executable_fix(ps_full):
    s, base = ps_full
    long_word = "x" * 50
    draft, errors = cd.apply_revisions(base.client_draft, [
        {"path": "experiences[0].bullet_points[0]", "text": f"Built {long_word} pipeline with **Python**"},
        {"path": "skills", "category": base.client_draft["skills"][0]["category"],
         "items": ["Python", "y" * 55]},
    ])
    assert not errors
    issue = cd._horizontal_issue(draft)
    assert issue["kind"] == "horizontal_overflow" and issue["severity"] == "blocking"
    fix = issue["suggested_fix"]
    assert fix["path"] == "skills" and "y" * 55 not in fix["items"]  # the widest token wins
    assert fix["items"] and len(fix["items"]) == 2  # replaced, not dropped (A10)
    patched, errors = cd.apply_revisions(draft, [issue["suggested_revision"]])
    assert errors == [] and cd.normalize_draft(s, patched)[1] == []
    # the reviewer's case: the only skill of the only category is the offending one
    lone, errors = cd.apply_revisions({**base.client_draft, "skills": [{"category": "Tools", "items": ["z" * 58]}]}, [
        {"path": "skills", "category": "Tools", "items": ["z" * 58]}])
    assert not errors
    fix = cd._horizontal_issue(lone)["suggested_revision"]
    assert fix["items"] and all(len(cd.longest_unbreakable(x)) < cd._LONG_TOKEN_CHARS for x in fix["items"])
    patched, errors = cd.apply_revisions(lone, [fix])
    assert errors == [] and cd.normalize_draft(s, patched)[1] == []
    # nothing in the draft: the instruction says how to proceed instead of asking for an impossible edit
    generic = cd._horizontal_issue(base.client_draft)
    assert "finalize=true" in generic["instruction"] and "suggested_fix" not in generic


# ── Font pinning (A1), brief estimates (A2), staging (A6), score (A12), finalize choice (A13) ──


def test_font_is_pinned_and_later_evaluations_render_once(pc_full):
    s, first = pc_full
    pin = first.layout["pinned_font_size"]
    assert pin == first.layout["font_size"] and first.attempts[cd.LAYOUT_KEY]["pinned_font_size"] == pin
    assert cd.pinned_font_size(first.attempts) == pin and first.layout["font_source"] == "fitted"
    assert first.layout["renders"] >= 3 and first.layout["render_ms"] > 0
    # an orphan-sized edit keeps the page full: one render at the pinned size, same font
    draft = _with_bullet(s, first, "experiences[0].bullet_points[1]", cut_to(BULLET_BANK[3], 150))
    second = evaluate(s, draft, submissions=2, attempts=first.attempts)
    assert second.layout["font_source"] == "pinned" and second.layout["renders"] == 1
    assert second.layout["font_size"] == pin and second.layout["pinned_font_size"] == pin
    # no longer fits at the pin: re-fit (smaller only) and re-pin
    grown, errors = cd.apply_revisions(second.client_draft, [
        {"op": "append", "path": "extracurriculars", "source_id": "extra_2", "text": cut_to(EXTRA_BANK[1], 170)},
        {"op": "append", "path": "extracurriculars", "source_id": "extra_3", "text": cut_to(EXTRA_BANK[2], 170)},
        {"path": "summary", "text": cut_to(" ".join(BULLET_BANK[:2]), 230)},
    ])
    assert not errors
    third = evaluate(s, grown, submissions=3, attempts=second.attempts)
    if third.layout["fits_target"]:
        assert third.layout["font_size"] < pin and third.layout["font_source"] == "refit_down"
        assert third.layout["pinned_font_size"] == third.layout["font_size"]
    # finalize renders at the pin when the draft fits at it
    fin = cd.finalize_draft(snapshot=s, tailored_resume=second.tailored_resume, submissions=2,
                            finalized_reason="requested", client_model=None, pinned_font_size=pin)
    assert fin.font_size == pin and fin.quality["font_source"] == "pinned"


@pytest.mark.parametrize("mode", ["proper", "larp"])
def test_brief_midpoint_bullets_render_clean_at_the_max_font(mode):
    """F1: bullets written around the middle of the brief's estimate, bolded the way the mode asks, are
    neither 3-line bullets nor mostly orphans at the maximum font (where a first draft is measured)."""
    for template in (PC, PS):
        s = snap(template, mode=mode)
        draft, errors = cd.normalize_draft(s, brief_draft(s, mid=True))
        assert errors == []
        tailored, _ = cd.merge_draft(s, draft)
        doc = resume_render.render_document_at(
            template_id=template, profile=s["profile"], resume=tailored, font_size=s["manifest"]["max_font_size"],
            page_margin_mm=s["manifest"]["page_margin_mm"], section_order=s["section_order"],
        )
        shapes = [v for k, v in resume_render.measure_bullet_lines(doc).items() if k[0] in ("experience", "projects")]
        assert shapes and max(v["lines"] for v in shapes) == 2, (template, mode)
        orphans = sum(1 for v in shapes if v["lines"] == 2 and (v["last_line_fill_percent"] or 0) < 80)
        assert orphans <= len(shapes) // 4, (template, mode, orphans, len(shapes))


@pytest.mark.parametrize("mode", ["proper", "larp"])
def test_brief_estimates_stay_on_two_lines_at_the_max_font(mode):
    """A2: a client that follows the brief's estimates gets no 3-line bullet even at the maximum font."""
    for template in (PC, PS):
        s = snap(template, mode=mode)
        draft, errors = cd.normalize_draft(s, brief_draft(s))
        assert errors == []
        tailored, _ = cd.merge_draft(s, draft)
        doc = resume_render.render_document_at(
            template_id=template, profile=s["profile"], resume=tailored, font_size=s["manifest"]["max_font_size"],
            page_margin_mm=s["manifest"]["page_margin_mm"], section_order=s["section_order"],
        )
        lines = [v["lines"] for k, v in resume_render.measure_bullet_lines(doc).items() if k[0] in ("experience", "projects")]
        assert lines and max(lines) == 2, (template, lines)
        ev = evaluate(s, brief_draft(s))
        assert ev.layout["oversize"] == 0, template


def test_withheld_issues_are_listed_as_upcoming_with_their_measured_windows():
    """F2: issues past the response cap are listed with path, kind, current length and the window
    measured at the (stable) font, so the client can fix them in the same round."""
    s = snap(PC)
    ev = evaluate(s, make_draft(s, bullet_chars=120, extra_chars=130))  # many orphans
    assert ev.more_issues >= 1 and ev.upcoming
    item = next(u for u in ev.upcoming if u["kind"] == "orphan")
    assert item["path"] and item["visible_chars"] < item["target_chars"]["min"] <= item["target_chars"]["aim"]
    assert item["measured_at_font"] == ev.layout["font_size"]
    if ev.layout["font_stable"]:
        assert "you may fix them in this same round" in ev.upcoming_note
    report = cd.evaluation_report(ev)
    assert report["upcoming"] == ev.upcoming and report["upcoming_note"] == ev.upcoming_note


def test_underfill_and_orphans_come_together_at_the_max_font():
    """F2: at the maximum font the pin cannot change while the page fits, so underfill and the orphans
    measured at that font are returned in one round, and the additions fit the free lines (F3a)."""
    s = snap(PC, mode="proper")
    ev = evaluate(s, make_draft(s, bullet_chars=150, bullets_per_entry=2, extras=0, summary_words=14, light=True))
    assert ev.layout["font_size"] == s["manifest"]["max_font_size"] and ev.layout["font_stable"] is True
    shown = kinds(ev, "blocking")
    assert "underfilled_page" in shown and "orphan" in shown


@pytest.mark.parametrize("template", [PC, PS])
def test_underfill_budget_never_suggests_more_lines_than_are_free(template):
    """F3a: the underfill issue states a hard line budget and its additions stay inside it."""
    s = snap(template)
    ev = evaluate(s, thin_draft(s))
    under = next(i for i in ev.issues if i["kind"] == "underfilled_page")
    budget = under["budget"]
    assert budget["free_lines"] == under["free_lines"] >= 1
    assert sum(a.get("adds_lines") or 0 for a in under["suggested_additions"]) <= budget["free_lines"]
    bullets = [a for a in under["suggested_additions"] if a["path"].endswith(".bullet_points")]
    assert len(bullets) <= budget["max_new_bullets"] <= budget["free_lines"] // 2
    assert f"about {budget['max_added_chars']} visible characters in total" in under["instruction"]
    if budget["max_new_bullets"]:
        assert f"add at most {budget['max_new_bullets']} new bullet" in under["instruction"]


def _overflowing_at_pin(s, first, lines):
    """first's draft with ``lines`` full two-line bullets grown onto a third line (one line each)."""
    draft = copy.deepcopy(first.client_draft)
    paths = [f"{sec}[{i}].bullet_points[{j}]" for sec in ("experiences", "projects")
             for i, e in enumerate(draft[sec]) for j in range(len(e["bullet_points"]))]
    revs = [{"path": p, "text": cut_to(cd._text_at(draft, p) + " " + BULLET_BANK[11], 245)} for p in paths[:lines]]
    grown, errors = cd.apply_revisions(draft, revs)
    assert not errors and len(revs) == lines, errors
    return grown


def test_small_overflow_holds_the_pin_once_then_refits(pc_full):
    """F3b: a draft a few lines over at the pinned font keeps the font and gets exact cuts at it; the
    next draft that is still too long is re-fitted (smaller), so it always reaches a fitting layout."""
    s, first = pc_full
    pin = first.layout["pinned_font_size"]
    over = _overflowing_at_pin(s, first, 2)
    held = evaluate(s, over, submissions=2, attempts=first.attempts)
    assert held.layout["font_source"] == "pinned_overflow" and held.layout["font_size"] == pin
    assert held.layout["fits_target"] is False and held.layout["pinned_font_size"] == pin
    assert held.attempts[cd.LAYOUT_KEY] == {"pinned_font_size": pin, "held_overflow": True}
    issue = next(i for i in held.issues if i["kind"] == "page_overflow")
    assert 1 <= issue["lines_over"] <= cd.OVERFLOW_HOLD_LINES
    assert f"at the current font ({pin}pt)" in issue["instruction"] and "smallest font" not in issue["instruction"]
    assert issue["suggested_cuts"] and issue["suggested_revisions"]
    # still too long next time: no second hold, the font is re-fitted smaller and the draft fits
    again = evaluate(s, over, submissions=3, attempts=held.attempts)
    assert again.layout["font_source"] == "refit_down" and again.layout["fits_target"] is True
    assert again.layout["font_size"] < pin and cd.LAYOUT_KEY in again.attempts
    assert "held_overflow" not in again.attempts[cd.LAYOUT_KEY]
    # never held on the last allowed submission
    last = evaluate(s, over, submissions=cd.max_submissions(), attempts=first.attempts)
    assert last.layout["font_source"] == "refit_down" and last.layout["fits_target"] is True
    # following the cuts at the held font fits at the pin
    revs = []
    for c in issue["suggested_cuts"]:
        if c["op"] == "remove":
            revs.append({"op": "remove", "path": c["path"]})
        else:
            revs.append({"path": c["path"], "text": cut_to(cd._text_at(held.client_draft, c["path"]), c["to_chars"])})
    revs.sort(key=lambda r: (r.get("op") == "remove", [-int(x) for x in re.findall(r"\d+", r["path"])]))
    cut, errors = cd.apply_revisions(held.client_draft, revs)
    assert not errors
    fixed = evaluate(s, cut, submissions=3, attempts=held.attempts)
    assert fixed.layout["fits_target"] is True and fixed.layout["font_size"] == pin


def test_large_overflow_at_the_pin_is_refitted_at_once(pc_full):
    s, first = pc_full
    pin = first.layout["pinned_font_size"]
    over = _overflowing_at_pin(s, first, 8)
    ev = evaluate(s, over, submissions=2, attempts=first.attempts)
    assert ev.layout["font_source"] == "refit_down" and ev.layout["font_size"] < pin


def test_score_prefers_a_later_fuller_draft_over_an_early_half_empty_one():
    """A12 (Luna run 1): the half-empty first draft hid its orphans behind the underfill stage and was
    kept as "best"; measured defects now count regardless of the stage shown."""
    s = snap(PC, mode="proper")
    early = evaluate(s, make_draft(s, bullet_chars=125, bullets_per_entry=2, extras=0, summary_words=14), submissions=1)
    assert early.layout["feedback_stage"] == 2 and early.layout["orphans"] >= 2  # orphans measured, not shown
    later_draft = full_draft(s)
    later_draft["experiences"][0]["bullet_points"][1] = cut_to(BULLET_BANK[3], 125)
    later_draft["projects"][0]["bullet_points"][1] = cut_to(BULLET_BANK[5], 125)
    later = evaluate(s, later_draft, submissions=2)
    assert later.layout["page_fill_percent"] > early.layout["page_fill_percent"]
    assert later.status == early.status == "needs_revision"
    assert later.score > early.score, (later.score, early.score)


def test_pick_final_draft_explicit_finalize_takes_the_latest_fitting_draft():
    fits = {"score": [1, 0, -4, -0.01], "fits_target": True, "draft_revision": 3}
    overflow = {"score": [0, 0, -30, -1.0], "fits_target": False, "draft_revision": 4}
    best = {"score": [1, 1, -1, -0.0], "fits_target": True, "draft_revision": 2}
    assert cd.pick_final_draft("requested", latest=fits, best=best) is fits
    assert cd.pick_final_draft("requested", latest=overflow, best=best) is best
    assert cd.pick_final_draft("submission_cap", latest=fits, best=best) is best
    assert cd.pick_final_draft("requested", latest=None, best=best) is best
    legacy = {"score": [1, -2, -3, -0.1, 0]}  # stored before fits_target was recorded
    assert cd.pick_final_draft("requested", latest=legacy, best=best) is legacy


def test_proper_mode_orphan_offers_source_detail_or_one_line_never_padding():
    s = snap(PS, mode="proper")
    draft = full_draft(s)
    draft["experiences"][0]["bullet_points"][1] = cut_to(BULLET_BANK[3], 125)
    ev = evaluate(s, draft)
    orphan = next(i for i in ev.issues if i["kind"] == "orphan" and i["path"] == "experiences[0].bullet_points[1]")
    text = orphan["instruction"]
    assert "(a) add about" in text and "(b) tighten it to one full line of" in text
    assert "Never pad with filler words" in text and "job-relevant detail" not in text
    one = orphan["one_line_chars"]
    assert one["min"] < one["max"] < orphan["visible_chars"]
    material = orphan.get("unused_source_material") or {}
    assert any(material.get(k) for k in ("technologies", "metrics", "source_phrases")), material
