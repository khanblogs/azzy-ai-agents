from __future__ import annotations

from datetime import UTC, datetime, timedelta

from azzy.costs import CostRow, daily_totals, hourly_series, price_for, remaining_budget, usd_for


def test_usd_for_known_models() -> None:
    # 1M in + 1M out on Sonnet = $18
    assert usd_for("bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0", 1_000_000, 1_000_000) == 18.0
    assert usd_for("openai/gpt-4o", 1_000_000, 0) == 2.5
    assert usd_for("anthropic/claude-3-5-sonnet-20241022", 2_000, 300) == round((2_000 * 3 + 300 * 15) / 1e6, 6)
    assert usd_for("stub/azzy-demo", 1_500, 200) > 0


def test_unknown_model_falls_back() -> None:
    assert price_for("bedrock/anthropic.claude-3-5-haiku-20241022-v1:0").input_per_m == 0.8
    assert price_for("something/haiku-x").input_per_m == 0.8
    assert price_for("mystery").input_per_m == 3.0
    assert usd_for("mystery", -5, -5) == 0.0


def test_daily_totals_and_series() -> None:
    now = datetime(2025, 1, 2, 10, 30, tzinfo=UTC)
    rows = [
        CostRow(now - timedelta(minutes=5), "jimmy", 0.10),
        CostRow(now - timedelta(hours=3), "emir", 0.25),
        CostRow(now - timedelta(days=1), "jimmy", 9.0),  # yesterday, excluded
    ]
    total, per_agent = daily_totals(rows, now)
    assert total == 0.35
    assert per_agent == {"jimmy": 0.1, "emir": 0.25}
    series = hourly_series(rows, hours=6, now=now)
    assert len(series) == 6
    assert series[-1]["hour"] == "2025-01-02T10:00:00Z" and series[-1]["usd"] == 0.1
    assert series[-4]["usd"] == 0.25
    assert remaining_budget(0.35, 25) == 24.65
