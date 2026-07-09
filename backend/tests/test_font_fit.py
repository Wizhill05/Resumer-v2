"""Unit tests for font_fit.py — uses fake oracle, no WeasyPrint required."""

import pytest
from src.services.font_fit import FontFitResult, find_best_font_size, quantize_font_range


# ── quantize_font_range ────────────────────────────────────────────────────────


def test_quantize_includes_min_and_max():
    sizes = quantize_font_range(9.0, 11.5, 0.05)
    assert sizes[0] == pytest.approx(9.0)
    assert sizes[-1] == pytest.approx(11.5)


def test_quantize_step_count():
    sizes = quantize_font_range(9.0, 11.5, 0.05)
    # (11.5 - 9.0) / 0.05 = 50 steps → 51 entries
    assert len(sizes) == 51


def test_quantize_min_equals_max():
    sizes = quantize_font_range(10.0, 10.0, 0.05)
    assert sizes == [10.0]


def test_quantize_single_step():
    sizes = quantize_font_range(9.0, 9.05, 0.05)
    assert len(sizes) == 2
    assert sizes[0] == pytest.approx(9.0)
    assert sizes[1] == pytest.approx(9.05)


# ── find_best_font_size ────────────────────────────────────────────────────────


def make_oracle(threshold: float):
    """Returns oracle: page_count=1 when font_size <= threshold, else 2."""
    def oracle(fs: float) -> int:
        return 1 if fs <= threshold else 2
    return oracle


def test_basic_fits_at_max():
    """All sizes fit → returns max_font_size."""
    result = find_best_font_size(
        render_page_count=lambda fs: 1,
        min_font_size=9.0,
        max_font_size=11.5,
    )
    assert result.fits_target is True
    assert result.font_size == pytest.approx(11.5, abs=0.05)
    assert result.page_count == 1


def test_nothing_fits():
    """All sizes overflow → returns min with fits_target=False."""
    result = find_best_font_size(
        render_page_count=lambda fs: 2,
        min_font_size=9.0,
        max_font_size=11.5,
    )
    assert result.fits_target is False
    assert result.font_size == pytest.approx(9.0, abs=0.05)
    assert result.page_count == 2


def test_threshold_midpoint():
    """Font sizes ≤ 10.5 fit; above → overflow."""
    oracle = make_oracle(10.5)
    result = find_best_font_size(
        render_page_count=oracle,
        min_font_size=9.0,
        max_font_size=11.5,
    )
    assert result.fits_target is True
    assert result.font_size == pytest.approx(10.5, abs=0.06)  # within 1 step
    assert result.page_count == 1


def test_threshold_at_min():
    """Only min fits."""
    oracle = make_oracle(9.0)
    result = find_best_font_size(
        render_page_count=oracle,
        min_font_size=9.0,
        max_font_size=11.5,
    )
    assert result.fits_target is True
    assert result.font_size == pytest.approx(9.0, abs=0.06)


def test_threshold_just_above_min():
    """9.05 and 9.0 fit but 9.1+ does not."""
    oracle = make_oracle(9.05)
    result = find_best_font_size(
        render_page_count=oracle,
        min_font_size=9.0,
        max_font_size=11.5,
    )
    assert result.fits_target is True
    assert result.font_size == pytest.approx(9.05, abs=0.06)


def test_target_pages_two():
    """target_pages=2: any size that produces ≤2 pages is acceptable."""
    # oracle: ≤10.0 → 1 page, ≤11.0 → 2 pages, >11.0 → 3 pages
    def oracle(fs: float) -> int:
        if fs <= 10.0:
            return 1
        elif fs <= 11.0:
            return 2
        return 3

    result = find_best_font_size(
        render_page_count=oracle,
        min_font_size=9.0,
        max_font_size=11.5,
        target_pages=2,
    )
    assert result.fits_target is True
    assert result.font_size == pytest.approx(11.0, abs=0.06)


def test_call_count_is_log2():
    """Binary search should call oracle O(log2 N) times, not N times."""
    calls = []

    def oracle(fs: float) -> int:
        calls.append(fs)
        return 1 if fs <= 10.0 else 2

    find_best_font_size(
        render_page_count=oracle,
        min_font_size=9.0,
        max_font_size=11.5,
    )
    # 51 steps → log2(51) ≈ 5.7 → at most 7 calls (with integer rounding)
    assert len(calls) <= 8, f"Expected ≤8 oracle calls, got {len(calls)}: {calls}"


def test_personal_classic_range():
    """Smoke test with exact personal-classic manifest values."""
    oracle = make_oracle(10.2)
    result = find_best_font_size(
        render_page_count=oracle,
        min_font_size=9.0,
        max_font_size=11.5,
        target_pages=1,
        step=0.05,
    )
    assert result.fits_target is True
    assert 10.15 <= result.font_size <= 10.25
