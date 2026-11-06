"""
font_fit.py — Discrete font-size binary search for resume page fitting.

Extracted from pipeline/nodes.py render_node so that:
  - editor save path can reuse it without importing pipeline state
  - unit tests can inject a fake page-count oracle
  - search is over discrete 0.05pt steps (not continuous midpoints)
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable, Union


@dataclass
class FontFitResult:
    font_size: float
    page_count: int
    fits_target: bool  # False → even min_font_size overflows; multi-page at min
    has_horizontal_overflow: bool = False


def quantize_font_range(
    min_fs: float,
    max_fs: float,
    step: float = 0.05,
) -> list[float]:
    """Return list of font sizes from min_fs to max_fs (inclusive) at given step."""
    if min_fs >= max_fs:
        return [round(min_fs, 4)]
    n = max(1, round((max_fs - min_fs) / step))
    sizes = [round(min_fs + i * step, 4) for i in range(n + 1)]
    # Clamp last entry to max_fs to avoid float drift
    if sizes[-1] > max_fs + step / 2:
        sizes.pop()
    if not sizes or sizes[-1] < max_fs - step / 2:
        sizes.append(round(max_fs, 4))
    return sizes


def find_best_font_size(
    *,
    render_page_count: Callable[[float], Union[int, tuple[int, bool]]],
    min_font_size: float,
    max_font_size: float,
    target_pages: int = 1,
    step: float = 0.05,
) -> FontFitResult:
    """
    Discrete binary search over quantize_font_range.

    Returns the largest font size where page_count <= target_pages and no horizontal overflow.
    If even min_font_size overflows, returns min with fits_target=False and real page_count.

    Args:
        render_page_count: Callable(font_size) -> int or tuple[int, bool]. Called once per probe.
            Returns page_count or (page_count, has_horizontal_overflow).
        min_font_size: Lower bound (inclusive).
        max_font_size: Upper bound (inclusive).
        target_pages: Maximum acceptable page count (usually 1).
        step: Quantization step in pt (default 0.05).
    """
    steps = quantize_font_range(min_font_size, max_font_size, step)
    cache: dict[float, tuple[int, bool]] = {}

    def _probe(fs: float) -> tuple[int, bool]:
        if fs not in cache:
            res = render_page_count(fs)
            if isinstance(res, tuple):
                cache[fs] = (int(res[0]), bool(res[1]))
            else:
                cache[fs] = (int(res), False)
        return cache[fs]

    lo, hi = 0, len(steps) - 1
    best_idx: int | None = None

    while lo <= hi:
        mid = (lo + hi) // 2
        pages, has_h = _probe(steps[mid])
        if pages <= target_pages and not has_h:
            best_idx = mid
            lo = mid + 1  # try larger
        else:
            hi = mid - 1

    if best_idx is None:
        # Even min overflowed
        pages, has_h = _probe(steps[0])
        return FontFitResult(
            font_size=steps[0],
            page_count=pages,
            fits_target=False,
            has_horizontal_overflow=has_h,
        )

    best_pages, best_has_h = _probe(steps[best_idx])
    return FontFitResult(
        font_size=steps[best_idx],
        page_count=best_pages,
        fits_target=True,
        has_horizontal_overflow=best_has_h,
    )


def iterations_needed(min_fs: float, max_fs: float, step: float = 0.05) -> int:
    """How many binary-search iterations for this range (informational)."""
    span = max(max_fs - min_fs, 0.01)
    return max(4, math.ceil(math.log2(max(span / step, 1))))
