"""Model price table (USD per 1M tokens) and cost helpers. Pure module (stdlib only)."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta


@dataclass(frozen=True, slots=True)
class Price:
    input_per_m: float
    output_per_m: float


# Prices are list prices (USD / 1M tokens). Unknown models fall back to the Sonnet rate.
PRICES: dict[str, Price] = {
    # Bedrock (ap-south-1 / us-east-1 list prices)
    "bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0": Price(3.00, 15.00),
    "bedrock/anthropic.claude-3-5-sonnet-20240620-v1:0": Price(3.00, 15.00),
    "bedrock/anthropic.claude-3-5-haiku-20241022-v1:0": Price(0.80, 4.00),
    "bedrock/anthropic.claude-3-haiku-20240307-v1:0": Price(0.25, 1.25),
    # Anthropic direct
    "anthropic/claude-3-5-sonnet-20241022": Price(3.00, 15.00),
    "anthropic/claude-3-5-haiku-20241022": Price(0.80, 4.00),
    # OpenAI
    "openai/gpt-4o": Price(2.50, 10.00),
    "openai/gpt-4o-mini": Price(0.15, 0.60),
    # Deterministic stub used in DEMO: priced like Sonnet so the dashboards look realistic.
    "stub/azzy-demo": Price(3.00, 15.00),
}

DEFAULT_PRICE = Price(3.00, 15.00)


def price_for(model: str) -> Price:
    if model in PRICES:
        return PRICES[model]
    lowered = model.lower()
    if "haiku" in lowered:
        return Price(0.80, 4.00)
    if "gpt-4o-mini" in lowered:
        return PRICES["openai/gpt-4o-mini"]
    if "gpt-4o" in lowered:
        return PRICES["openai/gpt-4o"]
    return DEFAULT_PRICE


def usd_for(model: str, in_tokens: int, out_tokens: int) -> float:
    """Cost of one call, rounded to 6 decimals (micro-dollars are visible on the dashboard)."""
    price = price_for(model)
    usd = (max(in_tokens, 0) * price.input_per_m + max(out_tokens, 0) * price.output_per_m) / 1_000_000
    return round(usd, 6)


@dataclass(frozen=True, slots=True)
class CostRow:
    ts: datetime
    agent: str
    usd: float


def utc_day_start(now: datetime | None = None) -> datetime:
    now = now or datetime.now(UTC)
    return now.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)


def is_today(ts: datetime, now: datetime | None = None) -> bool:
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    return ts.astimezone(UTC) >= utc_day_start(now)


def daily_totals(rows: Iterable[CostRow], now: datetime | None = None) -> tuple[float, dict[str, float]]:
    """(today_usd, per_agent) over rows whose timestamp falls in today's UTC day."""
    per_agent: dict[str, float] = {}
    total = 0.0
    for row in rows:
        if not is_today(row.ts, now):
            continue
        total += row.usd
        per_agent[row.agent] = per_agent.get(row.agent, 0.0) + row.usd
    return round(total, 6), {agent: round(usd, 6) for agent, usd in per_agent.items()}


def hourly_series(rows: Iterable[CostRow], hours: int = 24, now: datetime | None = None) -> list[dict[str, float | str]]:
    """Buckets of the last `hours` hours: [{hour: ISO, usd}], oldest first, zero-filled."""
    now = (now or datetime.now(UTC)).astimezone(UTC).replace(minute=0, second=0, microsecond=0)
    buckets: dict[datetime, float] = {}
    for offset in range(hours - 1, -1, -1):
        buckets[now - timedelta(hours=offset)] = 0.0
    for row in rows:
        ts = row.ts if row.ts.tzinfo else row.ts.replace(tzinfo=UTC)
        key = ts.astimezone(UTC).replace(minute=0, second=0, microsecond=0)
        if key in buckets:
            buckets[key] += row.usd
    return [
        {"hour": key.isoformat().replace("+00:00", "Z"), "usd": round(usd, 6)}
        for key, usd in buckets.items()
    ]


def remaining_budget(spent_usd: float, budget_usd: float) -> float:
    return round(max(budget_usd - spent_usd, 0.0), 6)
