"""Worker process: `python -m azzy.worker`.

* consumer-group loop over azzy:tasks:priority (chat) + azzy:tasks → AgentRunner.run_task, at most
  WORKER_CONCURRENCY (default 2) agent loops at once; chat replies are read first
* env health prober every HEALTH_PROBE_SECONDS (≥ 60 s), emits env.health
* APScheduler routines from agent YAML + the daily retention sweep
* approval expiry sweep, settings-override refresh, Redis heartbeat for /system/metrics
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import socket
from typing import Any

from azzy.agents.loader import get_agents
from azzy.agents.runner import AgentRunner
from azzy.audit import record as audit_record
from azzy.bus import Bus, get_bus
from azzy.config import Settings, apply_overrides, get_settings
from azzy.db import repo
from azzy.db.engine import dispose_engine, session_scope
from azzy.db.schema import init_schema, seed
from azzy.events import ApprovalExpiredEvent, PipelineState, TaskUpdatedEvent
from azzy.health import health_loop
from azzy.llm import LLM, AgentBudget, LiteLLMGateway, StubLLM
from azzy.logging_setup import setup_logging
from azzy.scheduler import build_scheduler

log = logging.getLogger("azzy.worker")

_spent_cache: dict[str, float] = {}


def build_llm(settings: Settings) -> LLM:
    if settings.DEMO:
        return StubLLM()
    budgets = {agent.id: AgentBudget(agent.budgets.daily_usd, agent.budgets.max_tokens_per_task, agent.budgets.model) for agent in get_agents().values()}
    return LiteLLMGateway(budgets, lambda agent_id: _spent_cache.get(agent_id, 0.0), region=settings.AWS_REGION, default_model=settings.BEDROCK_MODEL)


async def _every(stop: asyncio.Event, seconds: float, fn: Any, name: str) -> None:
    while not stop.is_set():
        try:
            await fn()
        except Exception as exc:  # noqa: BLE001
            log.warning(f"{name} failed", extra={"fields": {"error": type(exc).__name__}})
        try:
            await asyncio.wait_for(stop.wait(), timeout=seconds)
        except TimeoutError:
            continue


async def refresh_spent_cache() -> None:
    async with session_scope() as session:
        for agent_id in get_agents():
            _spent_cache[agent_id] = await repo.agent_spent_today(session, agent_id)


async def refresh_overrides(settings: Settings) -> None:
    async with session_scope() as session:
        apply_overrides(settings, await repo.get_settings_overrides(session))


async def expiry_sweep(bus: Bus) -> None:
    async with session_scope() as session:
        expired = await repo.expire_stale_approvals(session)
        models = [repo.approval_to_model(r) for r in expired]
        failed = []
        for task_id in {r.task_id for r in expired}:
            row = await repo.update_task(session, task_id, state=PipelineState.failed.value, result="approval expired")
            if row:
                failed.append(repo.task_to_model(row))
    for model in models:
        await bus.publish(ApprovalExpiredEvent(approval=model))
        await bus.notify_approval(model.id, "expired")
    for task in failed:
        await bus.publish(TaskUpdatedEvent(task=task))


async def retention_sweep(settings: Settings, bus: Bus, routine: dict[str, Any] | None = None) -> None:
    async with session_scope() as session:
        counts = await repo.purge_old(session, knowledge_days=settings.KNOWLEDGE_RETENTION_DAYS, memory_days=settings.MEMORY_RETENTION_DAYS)
    await audit_record(bus, actor="system", action="retention.sweep", detail={**counts, "knowledge_days": settings.KNOWLEDGE_RETENTION_DAYS, "memory_days": settings.MEMORY_RETENTION_DAYS})
    log.info("retention sweep", extra={"fields": counts})


async def consume(runner: AgentRunner, bus: Bus, settings: Settings, stop: asyncio.Event) -> None:
    consumer = f"{socket.gethostname()}-{os.getpid()}"
    semaphore = asyncio.Semaphore(settings.WORKER_CONCURRENCY)
    inflight: set[asyncio.Task[None]] = set()

    async def handle(stream: str, entry_id: str, task_id: str) -> None:
        async with semaphore:
            try:
                await runner.run_task(task_id)
            finally:
                try:
                    await bus.ack_task(stream, entry_id)
                except Exception as exc:  # noqa: BLE001
                    log.warning("ack failed", extra={"fields": {"entry": entry_id, "error": type(exc).__name__}})

    stale_check = 0
    while not stop.is_set():
        if len(inflight) >= settings.WORKER_CONCURRENCY:
            # Do not pull more work than we can run; keeps the host light and the queue honest.
            await asyncio.wait(inflight, timeout=1.0, return_when=asyncio.FIRST_COMPLETED)
            continue
        try:
            entries = await bus.read_tasks(consumer, count=settings.WORKER_CONCURRENCY - len(inflight), block_ms=3000)
            stale_check += 1
            if stale_check % 20 == 0:
                entries += await bus.claim_stale_tasks(consumer)
        except Exception as exc:  # noqa: BLE001 - redis hiccup: back off and retry
            log.warning("queue read failed", extra={"fields": {"error": type(exc).__name__}})
            await asyncio.sleep(2)
            continue
        for stream, entry_id, task_id in entries:
            task = asyncio.create_task(handle(stream, entry_id, task_id))
            inflight.add(task)
            task.add_done_callback(inflight.discard)
    if inflight:
        log.info("draining", extra={"fields": {"inflight": len(inflight)}})
        await asyncio.gather(*inflight, return_exceptions=True)


async def main() -> None:
    settings = get_settings()
    setup_logging(settings.LOG_LEVEL)
    log.info("worker starting", extra={"fields": {"demo": settings.DEMO, "concurrency": settings.WORKER_CONCURRENCY, "agents_dir": str(settings.AGENTS_DIR)}})
    await init_schema()
    await seed()
    bus = get_bus()
    await bus.wait_ready()
    await bus.ensure_group()
    await refresh_overrides(settings)

    runner = AgentRunner(settings, bus, build_llm(settings))
    stop = asyncio.Event()

    async def fire_routine(agent_id: str, routine: dict[str, Any]) -> None:
        from azzy.orchestrator.service import run_routine  # noqa: PLC0415

        async with session_scope() as session:
            await run_routine(session, bus, agent_id, routine["id"], routine["title"], routine["prompt"])

    async def fire_system(routine: dict[str, Any]) -> None:
        await retention_sweep(settings, bus, routine)

    scheduler = build_scheduler(fire_routine, fire_system)
    scheduler.start()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    tasks = [
        asyncio.create_task(consume(runner, bus, settings, stop), name="consume"),
        asyncio.create_task(health_loop(settings, bus, stop), name="health"),
        asyncio.create_task(_every(stop, 60, lambda: expiry_sweep(bus), "expiry sweep"), name="expiry"),
        asyncio.create_task(_every(stop, 60, lambda: refresh_overrides(settings), "overrides refresh"), name="overrides"),
        asyncio.create_task(_every(stop, 30, bus.heartbeat, "heartbeat"), name="heartbeat"),
    ]
    if not settings.DEMO:
        tasks.append(asyncio.create_task(_every(stop, 60, refresh_spent_cache, "spent cache"), name="spent"))
    try:
        await stop.wait()
    finally:
        scheduler.shutdown(wait=False)
        await asyncio.gather(*tasks, return_exceptions=True)
        await bus.close()
        await dispose_engine()
        log.info("worker stopped")


if __name__ == "__main__":
    asyncio.run(main())
