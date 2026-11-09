from datetime import date, datetime, timezone

import httpx
import pytest

from src.api import admin
from src.services import posthog_insights as ph

TODAY = date(2026, 11, 8)


def at(day: int, hour: int = 12) -> datetime:
    return datetime(2026, 11, day, hour, tzinfo=timezone.utc)


def test_product_overview_buckets_and_cumulative_users():
    result = admin.build_product_overview(
        user_created=[at(8), at(8, 3), at(7), at(1)],
        generations=[
            (at(8), "completed", False, "u1"),
            (at(8), "failed", False, "u1"),
            (at(8), "completed", True, None),
            (at(7), "in_progress", False, "u2"),
        ],
        total_users=10,
        pro_users=2,
        days=7,
        today=TODAY,
    )
    assert result["dates"][-1] == "2026-11-08"
    assert result["signups"] == [0, 0, 0, 0, 0, 1, 2]
    assert result["users_total"][-1] == 10
    assert result["users_total"][-2] == 8
    assert result["users_total"][0] == 7
    assert result["generations"]["total"][-1] == 3
    assert result["generations"]["completed"][-1] == 2
    assert result["generations"]["guest"][-1] == 1
    assert result["builders"][-1] == 1
    assert result["kpis"]["new_users_today"] == 2
    assert result["kpis"]["generations_7d"] == 4


def test_product_overview_ignores_rows_outside_window():
    result = admin.build_product_overview([at(1)], [(at(1), "completed", False, "u")], 1, 0, 7, date(2026, 11, 20))
    assert sum(result["signups"]) == 0
    assert sum(result["generations"]["total"]) == 0


def test_activity_rolling_windows_and_deltas():
    pairs = [["2026-11-08", "a"], ["2026-11-08", "b"], ["2026-11-07", "a"], ["2026-11-02", "c"], ["2026-10-20", "d"]]
    traffic = [["2026-11-08", 10, 4], ["2026-11-07", 6, 2]]
    result = ph.build_activity(pairs, traffic, live=3, days=7, today=TODAY)
    kpis = result["kpis"]
    assert kpis["dau"] == 2 and kpis["dau_prev"] == 1
    assert kpis["wau"] == 3  # a, b, c within the last seven days
    assert kpis["mau"] == 4  # d sits 19 days back, inside the 30 day window
    assert kpis["pageviews_today"] == 10 and kpis["sessions_today"] == 4
    assert kpis["active_now"] == 3
    assert kpis["stickiness"] == 50.0
    assert len(result["dau"]) == 7 and result["wau"][-1] == 3


def test_funnel_keeps_step_order_and_zero_fills():
    funnel = ph.build_funnel([["$pageview", 50], ["resume_generation_completed", 4]])
    assert [step["id"] for step in funnel] == ["visited", "signed_in", "requested", "completed", "downloaded"]
    assert [step["value"] for step in funnel] == [50, 0, 0, 4, 0]


def test_api_host_derives_app_host_from_ingest_host(monkeypatch):
    monkeypatch.setattr(ph.settings, "POSTHOG_API_HOST", "")
    monkeypatch.setattr(ph.settings, "POSTHOG_HOST", "https://eu.i.posthog.com")
    assert ph.api_host() == "https://eu.posthog.com"


@pytest.mark.asyncio
async def test_posthog_overview_reports_unconfigured(monkeypatch):
    monkeypatch.setattr(ph.settings, "POSTHOG_PERSONAL_API_KEY", "")
    result = await admin.get_overview_posthog(days=30)
    assert result["configured"] is False and result["data"] is None and result["error"] is None


@pytest.mark.asyncio
async def test_posthog_overview_surfaces_bad_key(monkeypatch):
    monkeypatch.setattr(ph.settings, "POSTHOG_PERSONAL_API_KEY", "phx_test")
    monkeypatch.setattr(ph.settings, "POSTHOG_PROJECT_ID", "1")
    monkeypatch.setattr(ph.settings, "POSTHOG_HOST", "https://us.i.posthog.com")
    ph.clear_cache()
    transport = httpx.MockTransport(lambda request: httpx.Response(401, json={"detail": "no"}))
    real = httpx.AsyncClient
    monkeypatch.setattr(ph.httpx, "AsyncClient", lambda **kw: real(transport=transport, **kw))
    result = await admin.get_overview_posthog(days=30)
    assert result["configured"] is True and result["data"] is None
    assert "Query: read" in result["error"]


@pytest.mark.asyncio
async def test_posthog_overview_success_is_cached(monkeypatch):
    monkeypatch.setattr(ph.settings, "POSTHOG_PERSONAL_API_KEY", "phx_test")
    monkeypatch.setattr(ph.settings, "POSTHOG_PROJECT_ID", "1")
    monkeypatch.setattr(ph.settings, "POSTHOG_HOST", "https://us.i.posthog.com")
    ph.clear_cache()
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json={"results": []})

    transport = httpx.MockTransport(handler)
    real = httpx.AsyncClient
    monkeypatch.setattr(ph.httpx, "AsyncClient", lambda **kw: real(transport=transport, **kw))
    first = await admin.get_overview_posthog(days=30)
    count = len(calls)
    second = await admin.get_overview_posthog(days=30)
    assert first["data"]["activity"]["kpis"]["dau"] == 0
    assert second["data"] == first["data"] and len(calls) == count
    assert calls[0].headers["authorization"] == "Bearer phx_test"
    ph.clear_cache()


@pytest.mark.asyncio
async def test_overview_queries_count_live_site_people_only(monkeypatch):
    queries: list[str] = []

    async def fake_run(client, hogql):
        queries.append(hogql)
        return []

    monkeypatch.setattr(ph, "_run_query", fake_run)
    await ph._fetch_overview(7)
    assert queries and all("properties.environment = 'production'" in q for q in queries)
    funnel = next(q for q in queries if "signed_in_visit" in q)
    assert "uniq(person_id)" in funnel
    assert "distinct_id" not in funnel.split("FROM")[0]
    assert any(":id" in q for q in queries), "per-record page URLs should be collapsed"
