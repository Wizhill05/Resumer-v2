"""Multi-round, per-bullet orphan repair.

The repair model cannot see rendered line widths, so a pass often lands a few
characters over the two-line limit. These tests pin the guarantees that make the
repair converge instead of discarding everything:

- every bullet gets a numeric visible-character window (aimed low),
- only bullets that spill onto a 3rd line are reverted; the rest are kept,
- failed bullets are re-asked alone, with the measured result as feedback,
- rounds are bounded, and a round that changes nothing stops the loop.
"""

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.pipeline import nodes as nodes_mod

LIMIT = 200  # fake renderer: a bullet longer than this wraps onto a 3rd line
GOOD = "G" * 150  # fits and is filled
LONG = "L" * 230  # overshoots to 3 lines


def _orphan(entry_idx: int, bullet_idx: int, text: str) -> dict:
    return {
        "fix_type": "expand",
        "section": "experience",
        "entry_idx": entry_idx,
        "bullet_idx": bullet_idx,
        "text": text,
        "renderedLines": 2,
        "lastLineFillPercent": 30.0,
        "minimumLastLineFill": 75,
        "charsPerLine": 110,
        "targetCharsMin": 199,
        "targetCharsMax": 216,
    }


def _state(bullets: list[str]) -> dict:
    return {
        "experience_draft": [
            {"role": "Engineer", "organization": "Acme", "bullet_points": list(bullets)}
        ],
        "projects_draft": [],
        "extracurriculars_draft": [],
        "keywords": ["Python"],
        "is_pro": False,
        "repair_attempts": 0,
        "repair_history": {},
        "page_count": 1,
        "font_size": 10.0,
        "template_manifest": {"id": "t", "target_pages": 1, "page_margin_mm": 15},
        "profile": {"full_name": "Test User"},
        "tailored_resume": {"experiences": [], "projects": [], "education": []},
        "orphans": [_orphan(0, i, b) for i, b in enumerate(bullets)],
    }


class Harness:
    """Fake LLM + fake renderer, driven by per-call scripted replacements."""

    def __init__(self, monkeypatch, scripted: list[dict[int, str]], pages_for=None):
        self.prompts: list[str] = []
        self.scripted = list(scripted)
        self.pages_for = pages_for or (lambda bullets: 1)

        async def invoke(chain_factory, messages, **kwargs):
            self.prompts.append(messages[1].content)
            replies = self.scripted.pop(0) if self.scripted else {}
            msg = MagicMock()
            msg.content = json.dumps(
                {"bullets": [{"index": i, "replacement": t} for i, t in replies.items()]}
            )
            return msg

        def render(state, experiences, projects, extracurriculars):
            bullets = experiences[0]["bullet_points"]
            found = [
                {
                    "fix_type": "oversize",
                    "section": "experience",
                    "entry_idx": 0,
                    "bullet_idx": i,
                    "text": b,
                    "renderedLines": 3,
                }
                for i, b in enumerate(bullets)
                if len(b) > LIMIT
            ] + [
                {
                    "fix_type": "expand",
                    "section": "experience",
                    "entry_idx": 0,
                    "bullet_idx": i,
                    "text": b,
                    "renderedLines": 2,
                    "lastLineFillPercent": 40.0,
                    "minimumLastLineFill": 75,
                    "charsPerLine": 110,
                    "targetCharsMin": 199,
                    "targetCharsMax": 216,
                }
                for i, b in enumerate(bullets)
                if len(b) < 120
            ]
            return self.pages_for(bullets), found

        monkeypatch.setattr(nodes_mod, "invoke_with_fallback", invoke)
        monkeypatch.setattr(nodes_mod, "_render_for_verification", render)
        monkeypatch.setattr(nodes_mod, "log_progress", AsyncMock(return_value=None))
        monkeypatch.setattr(
            nodes_mod,
            "get_prompt_config",
            AsyncMock(return_value=("sys", "{kw_text}\n{bullet_blocks}")),
        )

    async def run(self, state):
        return await nodes_mod.orphan_repair_node(state, db=AsyncMock(), gen_id="g")


def _bullets(result):
    return result["experience_draft"][0]["bullet_points"]


async def test_prompt_contains_numeric_window_aimed_low(monkeypatch):
    original = "x" * 90
    h = Harness(monkeypatch, [{1: GOOD}])
    await h.run(_state([original]))

    prompt = h.prompts[0]
    assert "between 199 and 216 visible characters" in prompt
    # aim = 199 + round(17 * 0.35) = 205, well under the 216 ceiling
    assert "aim for about 205" in prompt
    assert "add roughly 115" in prompt
    assert "3rd line" in prompt


async def test_prompt_without_window_data_keeps_legacy_wording(monkeypatch):
    state = _state(["x" * 90])
    for key in ("charsPerLine", "targetCharsMin", "targetCharsMax"):
        state["orphans"][0].pop(key)
    h = Harness(monkeypatch, [{1: GOOD}])
    await h.run(state)

    assert "LENGTH TARGET" not in h.prompts[0]
    assert "do not estimate character counts" in h.prompts[0]


async def test_overshoot_is_reverted_but_good_bullet_is_kept(monkeypatch):
    monkeypatch.setattr(nodes_mod, "ORPHAN_REPAIR_MAX_ROUNDS", 1)
    originals = ["a" * 100, "b" * 100]
    h = Harness(monkeypatch, [{1: GOOD, 2: LONG}])

    result = await h.run(_state(originals))

    assert _bullets(result) == [GOOD, originals[1]]
    assert set(result["repair_history"]) == {"experience:0:0"}


async def test_failed_bullet_is_retried_alone_with_measured_feedback(monkeypatch):
    originals = ["a" * 100, "b" * 100]
    fixed = "F" * 160
    h = Harness(monkeypatch, [{1: GOOD, 2: LONG}, {1: fixed}])

    result = await h.run(_state(originals))

    assert _bullets(result) == [GOOD, fixed]
    assert len(h.prompts) == 2
    retry = h.prompts[1]
    assert "Bullet 1:" in retry and "Bullet 2:" not in retry
    assert "PREVIOUS ATTEMPT FAILED (too long)" in retry
    assert LONG in retry and "230 characters" in retry
    assert "rendered on 3 lines" in retry
    assert "b" * 100 in retry  # re-asks from the pre-round original


async def test_short_bullet_is_kept_and_retried_from_its_new_text(monkeypatch):
    original = "a" * 100
    short = "s" * 110  # shorter than 120 -> renderer still reports an orphan
    final = "F" * 160
    h = Harness(monkeypatch, [{1: short}, {1: final}])

    result = await h.run(_state([original]))

    assert _bullets(result) == [final]
    assert f'Original: "{short}"' in h.prompts[1]
    # history still points at the very first original for later rollbacks
    assert result["repair_history"]["experience:0:0"] == original


async def test_rounds_are_bounded(monkeypatch):
    h = Harness(monkeypatch, [{1: LONG}] * 10)

    result = await h.run(_state(["a" * 100]))

    assert len(h.prompts) == nodes_mod.ORPHAN_REPAIR_MAX_ROUNDS
    assert _bullets(result) == ["a" * 100]
    assert result["repair_history"] == {}


async def test_time_budget_stops_further_rounds(monkeypatch):
    monkeypatch.setattr(nodes_mod, "ORPHAN_REPAIR_TIME_BUDGET_S", -1.0)
    h = Harness(monkeypatch, [{1: LONG}] * 5)

    result = await h.run(_state(["a" * 100]))

    assert len(h.prompts) == 1
    assert _bullets(result) == ["a" * 100]


async def test_unchanged_response_stops_without_retry(monkeypatch):
    original = "a" * 100
    h = Harness(monkeypatch, [{1: original}] * 3)

    result = await h.run(_state([original]))

    assert len(h.prompts) == 1
    assert _bullets(result) == [original]
    assert result["repair_history"] == {}


async def test_page_overflow_after_reverting_grown_bullets_reverts_everything(monkeypatch):
    monkeypatch.setattr(nodes_mod, "ORPHAN_REPAIR_MAX_ROUNDS", 1)
    originals = ["a" * 100, "b" * 100]
    # Even with the 3-line bullet reverted, the kept one still overflows the page.
    h = Harness(
        monkeypatch,
        [{1: GOOD, 2: LONG}],
        pages_for=lambda bullets: 2 if GOOD in bullets else 1,
    )

    result = await h.run(_state(originals))

    assert _bullets(result) == originals
    assert result["repair_history"] == {}


async def test_verification_unavailable_rolls_back_without_retry(monkeypatch):
    h = Harness(monkeypatch, [{1: GOOD}] * 3)

    def unavailable(*args, **kwargs):
        raise nodes_mod._VerifyUnavailable("missing template or profile")

    monkeypatch.setattr(nodes_mod, "_render_for_verification", unavailable)
    original = "a" * 100

    result = await h.run(_state([original]))

    assert len(h.prompts) == 1
    assert _bullets(result) == [original]
    assert result["repair_history"] == {}


async def test_llm_failure_on_first_round_changes_nothing(monkeypatch):
    h = Harness(monkeypatch, [])
    monkeypatch.setattr(
        nodes_mod, "invoke_with_fallback", AsyncMock(side_effect=RuntimeError("boom"))
    )
    original = "a" * 100

    result = await h.run(_state([original]))

    assert result["orphans"] is None
    assert result["repair_attempts"] == 1
    assert "experience_draft" not in result


@pytest.mark.parametrize(
    "orphan,text,expected",
    [
        ({"targetCharsMin": 199, "targetCharsMax": 216}, "x" * 90, (199, 216, 205)),
        ({"charsPerLine": 100}, "x" * 90, (180, 195, 185)),
        ({}, "x" * 90, None),
        ({"targetCharsMin": 199, "targetCharsMax": 216}, "x" * 214, None),
        # markdown bold markers are not visible characters
        ({"targetCharsMin": 199, "targetCharsMax": 216}, "**" + "x" * 90 + "**", (199, 216, 205)),
    ],
)
def test_length_window(orphan, text, expected):
    window = nodes_mod._repair_length_window(orphan, text)
    if expected is None:
        assert window is None
    else:
        assert (window["min"], window["max"], window["aim"]) == expected


async def test_short_result_that_is_not_fuller_is_reverted_with_feedback(monkeypatch):
    original = "a" * 100  # fake renderer reports a flat 40% fill for anything under 120 chars
    worse = "w" * 105
    h = Harness(monkeypatch, [{1: worse}, {1: GOOD}])
    state = _state([original])
    state["orphans"][0]["lastLineFillPercent"] = 60.0  # was already fuller than the 40% result

    result = await h.run(state)

    assert _bullets(result) == [GOOD]
    retry = h.prompts[1]
    assert "PREVIOUS ATTEMPT FAILED (too short)" in retry
    assert f'Original: "{original}"' in retry  # re-asked from the unchanged original


async def test_retained_short_text_is_counted_after_later_rounds_overshoot(monkeypatch):
    short = "s" * 110
    h = Harness(monkeypatch, [{1: short}, {1: LONG}, {1: LONG}])

    result = await h.run(_state(["a" * 100]))

    assert _bullets(result) == [short]
    assert result["repair_history"]["experience:0:0"] == "a" * 100
    message = nodes_mod.log_progress.await_args_list[-1].args[3]
    assert "applied 1/1" in message


async def test_empty_reply_after_a_failed_round_stops_the_loop(monkeypatch):
    originals = ["a" * 100, "b" * 100]
    # round 1: bullet 1 overshoots, bullet 2 fits. round 2: bullet 1 omitted entirely.
    # round 3: model replies with bullet 1 (now fixed).
    h = Harness(monkeypatch, [{1: LONG, 2: GOOD}, {}, {1: GOOD}])
    state = _state(originals)

    await h.run(state)

    # the empty round-2 reply changes nothing, so the loop stops instead of burning round 3
    assert len(h.prompts) == 2
    assert "PREVIOUS ATTEMPT FAILED (too long)" in h.prompts[1]


async def test_unchanged_reply_for_one_bullet_is_flagged_on_retry(monkeypatch):
    originals = ["a" * 100, "b" * 100]
    # round 1: bullet 1 unchanged, bullet 2 overshoots -> both pending in round 2
    h = Harness(monkeypatch, [{1: originals[0], 2: LONG}, {1: GOOD, 2: GOOD}])

    result = await h.run(_state(originals))

    assert _bullets(result) == [GOOD, GOOD]
    assert "you returned this bullet unchanged" in h.prompts[1]


async def test_in_flight_llm_call_is_bounded_by_time_budget(monkeypatch):
    import asyncio

    monkeypatch.setattr(nodes_mod, "ORPHAN_REPAIR_TIME_BUDGET_S", 0.05)
    h = Harness(monkeypatch, [])

    async def hang(*args, **kwargs):
        await asyncio.sleep(30)

    monkeypatch.setattr(nodes_mod, "invoke_with_fallback", hang)
    original = "a" * 100

    # max(remaining, 1.0) floor keeps the call bounded to ~1s instead of the endpoint chain
    result = await asyncio.wait_for(h.run(_state([original])), timeout=10)

    assert result["orphans"] is None and result["repair_attempts"] == 1


def test_block_wording_per_mode_and_feedback():
    orphan = _orphan(0, 0, "x" * 90)
    proper = nodes_mod._repair_block(1, "ctx", "x" * 90, orphan, False)
    larp = nodes_mod._repair_block(1, "ctx", "x" * 90, orphan, True)
    assert "Add truthful, job-relevant detail" in proper
    assert "plausible" not in proper
    assert "Add plausible, job-relevant detail or embellishment" in larp
    assert "truthful" not in larp
    failed = nodes_mod._repair_block(
        1, "ctx", "x" * 90, orphan, False,
        {"kind": "long", "text": "t" * 230, "chars": 230, "lines": 4},
    )
    assert "rendered on 4 lines" in failed and "230 characters" in failed


# ── Real WeasyPrint: exercises _match_orphan against genuine detector output ──

_REAL_BASE = {
    "template_id": "personal-classic",
    "template_manifest": {
        "id": "personal-classic", "target_pages": 1, "max_font_size": 10.0, "page_margin_mm": 15.0,
    },
    "profile": {"full_name": "Test User", "email": "test@example.com"},
    "page_count": 1,
    "font_size": 10.0,
    "projects_draft": [],
    "extracurriculars_draft": [],
    "keywords": ["Python"],
    "repair_attempts": 0,
    "repair_history": {},
}
_REAL_ORIGINAL = (
    "Engineered real-time analytics engine with WebSockets handling 50k concurrent "
    "client streams with sub-second latency."
)
_FILLER = [
    "across", "three", "regions", "using", "partitioned", "Redis", "caching", "and",
    "automated", "failover", "for", "high", "availability", "under", "peak", "traffic",
]


def _real_detect(bullet: str):
    return nodes_mod._render_for_verification(
        _REAL_BASE,
        [{"role": "Engineer", "organization": "Acme", "bullet_points": [bullet]}],
        [], [],
    )[1]


async def test_real_render_overshoot_is_reverted_then_retry_lands_in_window(monkeypatch):
    found = _real_detect(_REAL_ORIGINAL)
    assert [f["fix_type"] for f in found] == ["expand"], found
    orphan = found[0]
    assert orphan["targetCharsMin"] < orphan["targetCharsMax"]

    # A fitting replacement: grow the bullet until the real renderer stops flagging it.
    fitting = _REAL_ORIGINAL
    for word in _FILLER:
        fitting = fitting[:-1] + f" {word}."
        if not _real_detect(fitting):
            break
    assert not _real_detect(fitting), "could not build a fitting bullet for the test"
    overshoot = fitting + " " + " ".join(_FILLER) + " " + " ".join(_FILLER)
    assert [f["fix_type"] for f in _real_detect(overshoot)] == ["oversize"]

    replies = iter([{1: overshoot}, {1: fitting}])
    prompts: list[str] = []

    async def invoke(chain_factory, messages, **kwargs):
        prompts.append(messages[1].content)
        msg = MagicMock()
        msg.content = json.dumps(
            {"bullets": [{"index": 1, "replacement": t} for t in next(replies).values()]}
        )
        return msg

    monkeypatch.setattr(nodes_mod, "invoke_with_fallback", invoke)
    monkeypatch.setattr(nodes_mod, "log_progress", AsyncMock(return_value=None))
    monkeypatch.setattr(
        nodes_mod, "get_prompt_config",
        AsyncMock(return_value=("sys", "{kw_text}\n{bullet_blocks}")),
    )
    state = dict(
        _REAL_BASE,
        experience_draft=[{"role": "Engineer", "organization": "Acme", "bullet_points": [_REAL_ORIGINAL]}],
        orphans=found,
    )

    result = await nodes_mod.orphan_repair_node(state, db=AsyncMock(), gen_id="g")

    assert result["experience_draft"][0]["bullet_points"][0] == fitting
    assert len(prompts) == 2
    assert f"between {orphan['targetCharsMin']} and {orphan['targetCharsMax']}" in prompts[0]
    assert "PREVIOUS ATTEMPT FAILED (too long)" in prompts[1]
    assert not _real_detect(result["experience_draft"][0]["bullet_points"][0])
