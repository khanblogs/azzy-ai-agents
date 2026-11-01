"""Redis streams event bus + task queue + approval pub/sub.

Streams (see CONTRACT "Redis streams"):
  azzy:events    fan-out to UI / audit     field `data` = event JSON
  azzy:tasks     orchestrator → worker     field `task_id`, consumer group `workers`
  azzy:approval:{id}  pub/sub channel carrying {"status": "approved|rejected"}

Every published event is also persisted to the `audit` table (best effort, never raises).
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator
from typing import Any

import redis.asyncio as aioredis
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import ResponseError

from azzy.config import get_settings
from azzy.events import event_json

log = logging.getLogger("azzy.bus")

EVENTS_STREAM = "azzy:events"
TASKS_STREAM = "azzy:tasks"
PRIORITY_STREAM = "azzy:tasks:priority"  # chat replies jump ahead of routines/commands
WORKERS_GROUP = "workers"
HEARTBEAT_KEY = "azzy:worker:heartbeat"
EVENTS_MAXLEN = 5_000
TASKS_MAXLEN = 10_000


def approval_channel(approval_id: str) -> str:
    return f"azzy:approval:{approval_id}"


class Bus:
    def __init__(self, url: str | None = None) -> None:
        self._url = url or get_settings().REDIS_URL
        self._redis: aioredis.Redis | None = None
        self._audit_enabled = True

    # ---- connection -------------------------------------------------------------------

    @property
    def redis(self) -> aioredis.Redis:
        if self._redis is None:
            self._redis = aioredis.from_url(
                self._url, decode_responses=True, health_check_interval=30, socket_keepalive=True,
                retry_on_timeout=True,
            )
        return self._redis

    async def ping(self) -> bool:
        try:
            return bool(await self.redis.ping())
        except Exception:  # noqa: BLE001
            return False

    async def close(self) -> None:
        if self._redis is not None:
            await self._redis.aclose()
            self._redis = None

    async def wait_ready(self, retries: int = 30, delay: float = 2.0) -> None:
        for attempt in range(1, retries + 1):
            if await self.ping():
                return
            log.warning("redis not ready", extra={"fields": {"attempt": attempt}})
            await asyncio.sleep(delay)
        raise RuntimeError("redis unavailable")

    # ---- events -------------------------------------------------------------------------

    async def publish(self, event: Any) -> str | None:
        """XADD to azzy:events (+ audit). Returns the stream id, or None when Redis is down."""
        data = event_json(event)
        stream_id: str | None = None
        try:
            stream_id = await self.redis.xadd(EVENTS_STREAM, {"data": data}, maxlen=EVENTS_MAXLEN, approximate=True)
        except (RedisConnectionError, OSError) as exc:
            log.error("publish failed", extra={"fields": {"type": getattr(event, "type", "?"), "error": type(exc).__name__}})
        await self._audit(event, data)
        return stream_id

    async def _audit(self, event: Any, data: str) -> None:
        if not self._audit_enabled:
            return
        try:
            from azzy.db.engine import session_scope
            from azzy.db.repo import add_event_log

            payload = json.loads(data)
            if payload.get("type") == "chat.message" and (payload.get("message") or {}).get("streaming"):
                return  # streaming chunks are transient
            agent = payload.get("agent") or (payload.get("approval") or {}).get("agent") or (payload.get("task") or {}).get("lead") or (payload.get("message") or {}).get("from_agent")
            task_id = payload.get("task_id") or (payload.get("approval") or {}).get("task_id") or (payload.get("task") or {}).get("id") or (payload.get("message") or {}).get("task_id")
            async with session_scope() as session:
                await add_event_log(session, event_id=payload["id"], type_=payload["type"], agent=agent, task_id=task_id, payload=payload)
        except Exception as exc:  # noqa: BLE001 - audit is best effort
            log.debug("audit skipped", extra={"fields": {"error": type(exc).__name__}})

    async def subscribe(self, start: str = "$", block_ms: int = 5_000) -> AsyncIterator[dict[str, Any]]:
        """Async generator of event dicts from azzy:events, starting at `start` ('$' = only new)."""
        last = start
        while True:
            try:
                batches = await self.redis.xread({EVENTS_STREAM: last}, count=200, block=block_ms)
            except (RedisConnectionError, OSError) as exc:
                log.warning("subscribe reconnecting", extra={"fields": {"error": type(exc).__name__}})
                await asyncio.sleep(1.0)
                continue
            if not batches:
                continue
            for _stream, entries in batches:
                for entry_id, fields in entries:
                    last = entry_id
                    raw = fields.get("data")
                    if not raw:
                        continue
                    try:
                        yield json.loads(raw)
                    except json.JSONDecodeError:
                        continue

    async def recent_events(self, count: int = 100) -> list[dict[str, Any]]:
        try:
            entries = await self.redis.xrevrange(EVENTS_STREAM, count=count)
        except (RedisConnectionError, OSError):
            return []
        out: list[dict[str, Any]] = []
        for _id, fields in entries:
            try:
                out.append(json.loads(fields["data"]))
            except (KeyError, json.JSONDecodeError):
                continue
        return out

    # ---- task queue ----------------------------------------------------------------------

    async def ensure_group(self) -> None:
        for stream in (PRIORITY_STREAM, TASKS_STREAM):
            try:
                await self.redis.xgroup_create(stream, WORKERS_GROUP, id="0", mkstream=True)
            except ResponseError as exc:
                if "BUSYGROUP" not in str(exc):
                    raise

    async def enqueue_task(self, task_id: str, *, priority: bool = False) -> str:
        stream = PRIORITY_STREAM if priority else TASKS_STREAM
        return await self.redis.xadd(stream, {"task_id": task_id}, maxlen=TASKS_MAXLEN, approximate=True)

    async def read_tasks(self, consumer: str, count: int = 1, block_ms: int = 5_000) -> list[tuple[str, str, str]]:
        """Returns [(stream, entry_id, task_id)]; the priority stream is listed first in the read."""
        results: list[tuple[str, str, str]] = []
        batches = await self.redis.xreadgroup(WORKERS_GROUP, consumer, {PRIORITY_STREAM: ">", TASKS_STREAM: ">"}, count=count, block=block_ms)
        for stream, entries in batches or []:
            for entry_id, fields in entries:
                task_id = fields.get("task_id")
                if task_id:
                    results.append((stream, entry_id, task_id))
        results.sort(key=lambda r: 0 if r[0] == PRIORITY_STREAM else 1)
        return results

    async def claim_stale_tasks(self, consumer: str, min_idle_ms: int = 600_000, count: int = 10) -> list[tuple[str, str, str]]:
        """Re-claim entries another (dead) worker left pending for > min_idle_ms."""
        out: list[tuple[str, str, str]] = []
        for stream in (PRIORITY_STREAM, TASKS_STREAM):
            try:
                _next, entries, _deleted = await self.redis.xautoclaim(stream, WORKERS_GROUP, consumer, min_idle_ms, start_id="0-0", count=count)
            except ResponseError:
                continue
            out += [(stream, entry_id, fields["task_id"]) for entry_id, fields in entries if fields and fields.get("task_id")]
        return out

    async def ack_task(self, stream: str, entry_id: str) -> None:
        await self.redis.xack(stream, WORKERS_GROUP, entry_id)

    async def queue_depth(self) -> int:
        """Unacknowledged + unread entries across both task streams (approximate)."""
        depth = 0
        for stream in (PRIORITY_STREAM, TASKS_STREAM):
            try:
                info = await self.redis.xpending(stream, WORKERS_GROUP)
                depth += int(info.get("pending", 0)) if isinstance(info, dict) else 0
                groups = await self.redis.xinfo_groups(stream)
                for group in groups:
                    if group.get("name") == WORKERS_GROUP:
                        depth += int(group.get("lag") or 0)
            except Exception:  # noqa: BLE001
                continue
        return depth

    async def heartbeat(self, ttl: int = 90) -> None:
        await self.redis.set(HEARTBEAT_KEY, json.dumps({"ts": time.time()}), ex=ttl)

    async def worker_heartbeat(self) -> float | None:
        try:
            raw = await self.redis.get(HEARTBEAT_KEY)
        except Exception:  # noqa: BLE001
            return None
        if not raw:
            return None
        try:
            return float(json.loads(raw)["ts"])
        except (json.JSONDecodeError, KeyError, TypeError):
            return None

    # ---- approvals -----------------------------------------------------------------------

    async def notify_approval(self, approval_id: str, status: str) -> int:
        return int(await self.redis.publish(approval_channel(approval_id), json.dumps({"status": status})))

    async def wait_for_approval(self, approval_id: str, timeout: float) -> str | None:
        """Block until a decision arrives on the approval channel. Returns status or None on timeout."""
        pubsub = self.redis.pubsub()
        await pubsub.subscribe(approval_channel(approval_id))
        loop = asyncio.get_running_loop()
        future: asyncio.Future[str] = loop.create_future()

        async def reader() -> None:
            try:
                async for message in pubsub.listen():
                    if message.get("type") != "message":
                        continue
                    try:
                        status = str(json.loads(message["data"]).get("status", ""))
                    except (json.JSONDecodeError, TypeError, KeyError):
                        continue
                    if status and not future.done():
                        future.set_result(status)
                        return
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                if not future.done():
                    future.set_exception(exc)

        task = asyncio.create_task(reader())
        try:
            return await asyncio.wait_for(future, timeout=timeout)
        except TimeoutError:
            return None
        finally:
            task.cancel()
            try:
                await pubsub.unsubscribe(approval_channel(approval_id))
                await pubsub.aclose()
            except Exception:  # noqa: BLE001
                pass

    # ---- locks ---------------------------------------------------------------------------

    async def acquire_lock(self, name: str, ttl_seconds: int) -> bool:
        return bool(await self.redis.set(f"azzy:lock:{name}", "1", nx=True, ex=ttl_seconds))

    async def release_lock(self, name: str) -> None:
        await self.redis.delete(f"azzy:lock:{name}")

    async def lock_held(self, name: str) -> bool:
        return bool(await self.redis.exists(f"azzy:lock:{name}"))


_bus: Bus | None = None


def get_bus() -> Bus:
    global _bus
    if _bus is None:
        _bus = Bus()
    return _bus
