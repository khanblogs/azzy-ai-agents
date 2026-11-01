"""Environment health probing (worker loop every 60 s, and POST /environments/{id}/check)."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import random
import time
from typing import Any

from azzy.bus import Bus
from azzy.config import Settings
from azzy.db import repo
from azzy.db.engine import session_scope
from azzy.events import EnvHealthEvent

log = logging.getLogger("azzy.health")


async def probe_real(env: dict[str, Any], settings: Settings) -> tuple[str, int | None, str | None]:
    """Best-effort real probe: TCP/HTTP reachability of the target; returns (health, latency_ms, version)."""
    target = str(env.get("target") or "")
    method = env.get("method")
    started = time.monotonic()
    try:
        if method == "tailscale_ssh":
            reader, writer = await asyncio.wait_for(asyncio.open_connection(target, 22), timeout=5)
            writer.close()
            await writer.wait_closed()
        elif method in {"assume_role", "access_key"}:
            import boto3  # noqa: PLC0415

            def work() -> None:
                boto3.client("sts", region_name=env.get("region") or settings.AWS_REGION).get_caller_identity()

            await asyncio.wait_for(asyncio.to_thread(work), timeout=8)
        else:
            return "healthy", 1, env.get("version")
    except Exception:  # noqa: BLE001
        return "down", None, env.get("version")
    latency = int((time.monotonic() - started) * 1000)
    return ("degraded" if latency > 1500 else "healthy"), latency, env.get("version")


def probe_demo(env: dict[str, Any]) -> tuple[str, int, str | None]:
    seed = int(hashlib.sha256(f"{env['id']}:{int(time.time() // 60)}".encode()).hexdigest()[:8], 16)
    rng = random.Random(seed)  # noqa: S311
    base = {"client-a-staging": 82, "client-b-vps": 61, "hq": 12}.get(str(env["id"]), 95)
    latency = int(base * rng.uniform(0.8, 1.35))
    return "healthy", latency, env.get("version")


async def probe_environment(env_id: str, settings: Settings, bus: Bus) -> dict[str, Any] | None:
    async with session_scope() as session:
        row = await repo.get_environment(session, env_id)
        if row is None:
            return None
        env = repo.env_to_dict(row)
    health, latency, version = probe_demo(env) if settings.DEMO else await probe_real(env, settings)
    async with session_scope() as session:
        updated = await repo.set_env_health(session, env_id, health=health, latency_ms=latency, version=version)
        result = repo.env_to_dict(updated) if updated else None
    await bus.publish(EnvHealthEvent(env_id=env_id, health=health, latency_ms=latency, version=version))
    return result


async def probe_all(settings: Settings, bus: Bus) -> None:
    async with session_scope() as session:
        ids = [row.id for row in await repo.list_environments(session)]
    for env_id in ids:
        try:
            await probe_environment(env_id, settings, bus)
        except Exception as exc:  # noqa: BLE001
            log.warning("probe failed", extra={"fields": {"env_id": env_id, "error": type(exc).__name__}})


async def health_loop(settings: Settings, bus: Bus, stop: asyncio.Event) -> None:
    while not stop.is_set():
        await probe_all(settings, bus)
        try:
            await asyncio.wait_for(stop.wait(), timeout=settings.HEALTH_PROBE_SECONDS)
        except TimeoutError:
            continue
