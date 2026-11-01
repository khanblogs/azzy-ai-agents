"""FastAPI application: `uvicorn azzy.main:app --host 0.0.0.0 --port 8000 [--workers N]`.

Routes live under /api (nginx keeps the prefix); /healthz and /metrics are at the root. Each
uvicorn worker process owns its own WebSocket hub / Redis stream reader. The agent worker loop
does NOT run here — see azzy.worker.
"""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import text

from azzy import __version__
from azzy.agents.loader import get_agents
from azzy.api.routes import protected, public
from azzy.api.routes_v2 import public as public_v2
from azzy.api.routes_v2 import router as v2
from azzy.api.ws import hub, router as ws_router
from azzy.auth import DISABLED_SET, csrf_middleware
from azzy.bus import get_bus
from azzy.config import apply_overrides, get_settings
from azzy.db import repo
from azzy.db.engine import dispose_engine, get_engine, session_scope
from azzy.db.schema import init_schema, seed
from azzy.events import CREATOR_CREDIT, PRODUCT_NAME, PRODUCT_VERSION
from azzy.logging_setup import setup_logging
from azzy.metrics import HTTP_LATENCY, HTTP_REQUESTS, exposition, normalise_path
from azzy.policy import get_policy
from azzy.tools.registry import build_registry

log = logging.getLogger("azzy.api")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    setup_logging(settings.LOG_LEVEL)
    get_agents()  # validate the five YAMLs early
    build_registry(get_policy())  # every allowlisted tool has an implementation
    await init_schema()
    await seed()
    bus = get_bus()
    await bus.wait_ready()
    await bus.ensure_group()
    async with session_scope() as session:
        apply_overrides(settings, await repo.get_settings_overrides(session))
        disabled = await repo.disabled_emails(session)
    try:
        if disabled:
            await bus.redis.sadd(DISABLED_SET, *disabled)
    except Exception:  # noqa: BLE001
        pass
    hub.start()
    log.info("api started", extra={"fields": {"product": f"{PRODUCT_NAME} {PRODUCT_VERSION}", "demo": settings.DEMO, "version": __version__, "agents_dir": str(settings.AGENTS_DIR), "artifacts_dir": str(settings.ARTIFACTS_DIR)}})
    try:
        yield
    finally:
        await hub.stop()
        await bus.close()
        await dispose_engine()


app = FastAPI(
    title=f"{PRODUCT_NAME} API", version=__version__, description=CREATOR_CREDIT, lifespan=lifespan,
    docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None,
)


@app.middleware("http")
async def security_and_metrics(request: Request, call_next: Any) -> Response:
    started = time.perf_counter()
    response: Response = await csrf_middleware(request, call_next)
    path = normalise_path(request.url.path)
    if path.startswith("/api") or path in {"/healthz", "/metrics"}:
        HTTP_REQUESTS.labels(request.method, path, str(response.status_code)).inc()
        HTTP_LATENCY.labels(path).observe(time.perf_counter() - started)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("Cache-Control", "no-store")
    return response


app.include_router(public, prefix="/api")
app.include_router(public_v2, prefix="/api")
app.include_router(protected, prefix="/api")
app.include_router(v2, prefix="/api")
app.include_router(ws_router, prefix="/api")


@app.get("/healthz")
async def healthz() -> JSONResponse:
    try:
        async with get_engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
        db_ok = True
    except Exception:  # noqa: BLE001
        db_ok = False
    redis_ok = await get_bus().ping()
    status_code = 200 if (db_ok and redis_ok) else 503
    body: dict[str, Any] = {"ok": db_ok and redis_ok, "db": "ok" if db_ok else "down", "redis": "ok" if redis_ok else "down", "demo": get_settings().DEMO, "version": __version__, "product": PRODUCT_NAME}
    return JSONResponse(body, status_code=status_code)


@app.get("/metrics")
async def metrics() -> Response:
    """Prometheus exposition; nginx does not proxy this path (internal network only)."""
    payload, content_type = exposition()
    return Response(content=payload, media_type=content_type)


@app.exception_handler(ValueError)
async def value_error_handler(_: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=400)
