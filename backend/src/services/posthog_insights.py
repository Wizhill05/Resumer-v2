"""Read-side PostHog access for the admin overview.

Events are sent with the project token (see ``src.core.analytics``). Reading them back
needs a personal API key with the ``query:read`` scope plus the numeric project id, so
this module stays dormant until both are configured.
"""
import asyncio
import logging
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx

from src.core.config import settings

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 120
PAIR_ROW_LIMIT = 100_000
MAX_DAYS = 90
ROLLING_MONTH = 30

# Only live-site traffic counts. The frontend and backend tag every production event with
# environment=production, while local and preview servers send none, so this filter keeps
# working across domain changes. Admin traffic is the operator, not a user, so it never counts.
_SITE_TRAFFIC = (
    "properties.environment = 'production' "
    "AND coalesce(properties.$pathname, '') NOT LIKE '/admin%'"
)

# Per-record URLs (/try/result/<uuid>, /dashboard/history/<uuid>/edit) collapse into one row.
_PAGE_PATH = (
    "replaceRegexpAll(properties.$pathname, "
    "'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', ':id')"
)

# Property names are interpolated into HogQL, so only these may be requested.
BREAKDOWN_PROPERTIES = {
    "pages": _PAGE_PATH,
    "referrers": "properties.$referring_domain",
    "devices": "properties.$device_type",
    "countries": "properties.$geoip_country_name",
    "browsers": "properties.$browser",
}

FUNNEL_STEPS: list[tuple[str, str, str]] = [
    ("visited", "Visited", "$pageview"),
    ("signed_in", "Signed in", "signed_in_visit"),
    ("requested", "Started a resume", "resume_generation_requested"),
    ("completed", "Resume completed", "resume_generation_completed"),
    ("downloaded", "Downloaded", "resume_download_clicked"),
]

_cache: dict[int, tuple[float, dict[str, Any]]] = {}
_cache_lock = asyncio.Lock()


class PostHogQueryError(RuntimeError):
    pass


def is_configured() -> bool:
    return bool(settings.POSTHOG_PERSONAL_API_KEY and settings.POSTHOG_PROJECT_ID)


def api_host() -> str:
    if settings.POSTHOG_API_HOST:
        return settings.POSTHOG_API_HOST.rstrip("/")
    return settings.POSTHOG_HOST.replace(".i.posthog.com", ".posthog.com").rstrip("/")


def project_url() -> str | None:
    if not settings.POSTHOG_PROJECT_ID:
        return None
    return f"{api_host()}/project/{settings.POSTHOG_PROJECT_ID}"


async def _run_query(client: httpx.AsyncClient, hogql: str) -> list[list[Any]]:
    url = f"{api_host()}/api/projects/{settings.POSTHOG_PROJECT_ID}/query/"
    try:
        response = await client.post(
            url,
            headers={"Authorization": f"Bearer {settings.POSTHOG_PERSONAL_API_KEY}"},
            json={"query": {"kind": "HogQLQuery", "query": hogql}, "name": "resumer-admin-overview"},
        )
    except httpx.HTTPError as exc:
        raise PostHogQueryError(f"PostHog is unreachable ({type(exc).__name__})") from exc
    if response.status_code in (401, 403):
        raise PostHogQueryError("PostHog rejected the API key. It needs the Query: read scope.")
    if response.status_code == 404:
        raise PostHogQueryError("PostHog project not found. Check POSTHOG_PROJECT_ID.")
    if response.status_code == 429:
        raise PostHogQueryError("PostHog rate limit reached. Try again in a minute.")
    if response.status_code >= 400:
        raise PostHogQueryError(f"PostHog returned HTTP {response.status_code}.")
    return response.json().get("results") or []


def _parse_day(value: Any) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _day_range(days: int, today: date) -> list[date]:
    return [today - timedelta(days=offset) for offset in range(days - 1, -1, -1)]


def rolling_unique(users_by_day: dict[date, set[str]], day: date, window: int) -> int:
    seen: set[str] = set()
    for offset in range(window):
        seen |= users_by_day.get(day - timedelta(days=offset), set())
    return len(seen)


def build_activity(
    pairs: list[list[Any]],
    traffic: list[list[Any]],
    live: int,
    days: int,
    today: date,
) -> dict[str, Any]:
    """Turn raw (day, person) pairs and per-day traffic rows into the activity payload."""
    users_by_day: dict[date, set[str]] = {}
    for row in pairs:
        day = _parse_day(row[0])
        if day is not None:
            users_by_day.setdefault(day, set()).add(str(row[1]))
    views_by_day: dict[date, tuple[int, int]] = {}
    for row in traffic:
        day = _parse_day(row[0])
        if day is not None:
            views_by_day[day] = (int(row[1] or 0), int(row[2] or 0))

    dates = _day_range(days, today)
    dau = [len(users_by_day.get(day, set())) for day in dates]
    wau = [rolling_unique(users_by_day, day, 7) for day in dates]
    mau = [rolling_unique(users_by_day, day, ROLLING_MONTH) for day in dates]
    pageviews = [views_by_day.get(day, (0, 0))[0] for day in dates]
    sessions = [views_by_day.get(day, (0, 0))[1] for day in dates]

    def previous(series: list[int], offset: int) -> int:
        return series[-1 - offset] if len(series) > offset else 0

    return {
        "dates": [day.isoformat() for day in dates],
        "dau": dau,
        "wau": wau,
        "mau": mau,
        "pageviews": pageviews,
        "sessions": sessions,
        "kpis": {
            "dau": dau[-1],
            "dau_prev": previous(dau, 1),
            "wau": wau[-1],
            "wau_prev": previous(wau, 7),
            "mau": mau[-1],
            "mau_prev": previous(mau, 7),
            "pageviews_today": pageviews[-1],
            "pageviews_prev": previous(pageviews, 1),
            "sessions_today": sessions[-1],
            "sessions_prev": previous(sessions, 1),
            "active_now": live,
            "stickiness": round(dau[-1] / mau[-1] * 100, 1) if mau[-1] else 0.0,
        },
    }


def _rows_to_items(rows: list[list[Any]]) -> list[dict[str, Any]]:
    return [
        {"label": str(row[0]) if row[0] not in (None, "") else "(none)", "views": int(row[1] or 0), "visitors": int(row[2] or 0)}
        for row in rows
    ]


def build_funnel(rows: list[list[Any]]) -> list[dict[str, Any]]:
    counts = {str(row[0]): int(row[1] or 0) for row in rows}
    return [
        {"id": step_id, "label": label, "event": event, "value": counts.get(event, 0)}
        for step_id, label, event in FUNNEL_STEPS
    ]


async def _fetch_overview(days: int) -> dict[str, Any]:
    today = datetime.now(timezone.utc).date()
    pair_window = days + ROLLING_MONTH - 1
    events = ", ".join(f"'{event}'" for _, _, event in FUNNEL_STEPS)

    pairs_q = (
        "SELECT DISTINCT toString(toDate(timestamp)) AS day, toString(person_id) AS pid FROM events "
        f"WHERE event = '$pageview' AND timestamp >= now() - INTERVAL {pair_window} DAY AND {_SITE_TRAFFIC} "
        f"LIMIT {PAIR_ROW_LIMIT}"
    )
    traffic_q = (
        "SELECT toString(toDate(timestamp)) AS day, count() AS views, uniq(properties.$session_id) AS sessions "
        f"FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL {days} DAY AND {_SITE_TRAFFIC} "
        "GROUP BY day ORDER BY day"
    )
    live_q = (
        "SELECT uniq(person_id) FROM events "
        f"WHERE event = '$pageview' AND timestamp >= now() - INTERVAL 30 MINUTE AND {_SITE_TRAFFIC}"
    )
    # person_id, not distinct_id: a visitor who signs in switches distinct_id and would count twice.
    # ChatGPT/API builds never pass through the website steps, so they stay out of the funnel.
    funnel_q = (
        "SELECT event, uniq(person_id) FROM events "
        f"WHERE event IN ({events}) AND timestamp >= now() - INTERVAL {days} DAY AND {_SITE_TRAFFIC} "
        "AND (event != 'resume_generation_completed' OR properties.source = 'website') GROUP BY event"
    )
    breakdown_qs = {
        name: (
            f"SELECT {prop} AS label, count() AS views, uniq(person_id) AS visitors FROM events "
            f"WHERE event = '$pageview' AND timestamp >= now() - INTERVAL {days} DAY AND {_SITE_TRAFFIC} "
            "GROUP BY label ORDER BY views DESC LIMIT 8"
        )
        for name, prop in BREAKDOWN_PROPERTIES.items()
    }

    async with httpx.AsyncClient(timeout=25) as client:
        names = ["pairs", "traffic", "live", "funnel", *breakdown_qs]
        queries = [pairs_q, traffic_q, live_q, funnel_q, *breakdown_qs.values()]
        results = await asyncio.gather(*(_run_query(client, q) for q in queries), return_exceptions=True)

    by_name = dict(zip(names, results))
    failures = [r for r in results if isinstance(r, Exception)]
    if len(failures) == len(results):
        raise failures[0]

    def rows(name: str) -> list[list[Any]]:
        value = by_name[name]
        return [] if isinstance(value, Exception) else value

    pairs = rows("pairs")
    live_rows = rows("live")
    activity = build_activity(pairs, rows("traffic"), int(live_rows[0][0]) if live_rows else 0, days, today)
    return {
        "days": days,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "truncated": len(pairs) >= PAIR_ROW_LIMIT,
        "partial": bool(failures),
        "activity": activity,
        "funnel": build_funnel(rows("funnel")),
        "breakdowns": {name: _rows_to_items(rows(name)) for name in breakdown_qs},
    }


async def get_overview(days: int) -> dict[str, Any]:
    """Cached PostHog overview. Raises PostHogQueryError when PostHog cannot answer at all."""
    days = max(7, min(days, MAX_DAYS))
    async with _cache_lock:
        cached = _cache.get(days)
        if cached and time.monotonic() - cached[0] < CACHE_TTL_SECONDS:
            return cached[1]
    payload = await _fetch_overview(days)
    if not payload["partial"]:
        async with _cache_lock:
            _cache[days] = (time.monotonic(), payload)
    return payload


def clear_cache() -> None:
    _cache.clear()
