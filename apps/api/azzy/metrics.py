"""System metrics (GET /system/metrics) and the Prometheus exposition (GET /metrics)."""

from __future__ import annotations

import time
from typing import Any

from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Counter, Gauge, Histogram, generate_latest

from azzy import __version__

REGISTRY = CollectorRegistry()

HTTP_REQUESTS = Counter("azzy_http_requests_total", "HTTP requests", ["method", "path", "status"], registry=REGISTRY)
HTTP_LATENCY = Histogram("azzy_http_request_seconds", "HTTP request latency", ["path"], registry=REGISTRY, buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5))
WS_CLIENTS = Gauge("azzy_ws_clients", "Connected WebSocket clients (this process)", registry=REGISTRY)
QUEUE_DEPTH = Gauge("azzy_queue_depth", "Task queue depth", registry=REGISTRY)
TASKS_ACTIVE = Gauge("azzy_tasks_active", "Active tasks", registry=REGISTRY)
APPROVALS_PENDING = Gauge("azzy_approvals_pending", "Pending approvals", registry=REGISTRY)
INCIDENTS_OPEN = Gauge("azzy_incidents_open", "Open incidents", registry=REGISTRY)
TODAY_USD = Gauge("azzy_llm_usd_today", "LLM spend today (USD)", registry=REGISTRY)
WORKER_OK = Gauge("azzy_worker_ok", "1 when a worker heartbeat was seen in the last 90 s", registry=REGISTRY)
DB_OK = Gauge("azzy_db_ok", "1 when Postgres answers", registry=REGISTRY)
REDIS_OK = Gauge("azzy_redis_ok", "1 when Redis answers", registry=REGISTRY)
INFO = Gauge("azzy_build_info", "Build info", ["version"], registry=REGISTRY)
INFO.labels(version=__version__).set(1)

STARTED_AT = time.monotonic()


def normalise_path(path: str) -> str:
    """Collapse ids so label cardinality stays tiny."""
    parts = []
    for segment in path.split("/"):
        if len(segment) >= 20 or (segment.count("-") >= 2 and len(segment) > 12):
            parts.append("{id}")
        else:
            parts.append(segment)
    return "/".join(parts)


async def collect(session: Any, bus: Any, settings: Any, *, db_ok: bool, redis_ok: bool, ws_clients: int) -> dict[str, Any]:
    from azzy.db import repo  # noqa: PLC0415

    counts = await repo.task_counts(session) if db_ok else {}
    pending = len(await repo.list_approvals(session, "pending")) if db_ok else 0
    incidents = await repo.open_incident_count(session) if db_ok else 0
    costs = await repo.cost_summary(session, settings.DAILY_BUDGET_USD) if db_ok else {"today_usd": 0.0}
    heartbeat = await bus.worker_heartbeat() if redis_ok else None
    worker_ok = heartbeat is not None and (time.time() - heartbeat) < 90
    depth = await bus.queue_depth() if redis_ok else 0
    WS_CLIENTS.set(ws_clients)
    QUEUE_DEPTH.set(depth)
    TASKS_ACTIVE.set(counts.get("active", 0))
    APPROVALS_PENDING.set(pending)
    INCIDENTS_OPEN.set(incidents)
    TODAY_USD.set(costs["today_usd"])
    WORKER_OK.set(1 if worker_ok else 0)
    DB_OK.set(1 if db_ok else 0)
    REDIS_OK.set(1 if redis_ok else 0)
    return {
        "uptime_seconds": int(time.monotonic() - STARTED_AT), "ws_clients": ws_clients, "queue_depth": depth,
        "worker_heartbeat_ts": heartbeat, "worker_ok": worker_ok, "db_ok": db_ok, "redis_ok": redis_ok,
        "tasks_active": counts.get("active", 0), "approvals_pending": pending, "incidents_open": incidents,
        "today_usd": costs["today_usd"], "version": __version__, "demo": settings.DEMO,
    }


def exposition() -> tuple[bytes, str]:
    return generate_latest(REGISTRY), CONTENT_TYPE_LATEST
