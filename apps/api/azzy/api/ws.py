"""WebSocket /api/ws: cookie auth, hello, ping/pong, fan-out from the Redis events stream.

One stream reader per process feeds an in-memory fan-out; each connection has a bounded queue
and slow clients are dropped (closed with 1013 "try again later").
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from azzy.auth import ws_owner
from azzy.bus import get_bus
from azzy.config import get_settings
from azzy.events import now_iso

log = logging.getLogger("azzy.ws")

router = APIRouter()
QUEUE_SIZE = 500


class Hub:
    def __init__(self) -> None:
        self._clients: set[asyncio.Queue[str]] = set()
        self._reader: asyncio.Task[None] | None = None

    def start(self) -> None:
        if self._reader is None or self._reader.done():
            self._reader = asyncio.create_task(self._pump(), name="ws-pump")

    async def stop(self) -> None:
        if self._reader:
            self._reader.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._reader
            self._reader = None

    async def _pump(self) -> None:
        bus = get_bus()
        while True:
            try:
                async for event in bus.subscribe("$"):
                    payload = json.dumps(event)
                    for queue in list(self._clients):
                        try:
                            queue.put_nowait(payload)
                        except asyncio.QueueFull:
                            # Drop the slow client: detach and leave a sentinel it will see when it drains.
                            self._clients.discard(queue)
                            with contextlib.suppress(asyncio.QueueEmpty):
                                queue.get_nowait()
                            queue.put_nowait("__slow__")
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                log.warning("ws pump restarting", extra={"fields": {"error": type(exc).__name__}})
                await asyncio.sleep(1.0)

    def attach(self) -> asyncio.Queue[str]:
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=QUEUE_SIZE)
        self._clients.add(queue)
        return queue

    def detach(self, queue: asyncio.Queue[str]) -> None:
        self._clients.discard(queue)

    @property
    def clients(self) -> int:
        return len(self._clients)


hub = Hub()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    if ws_owner(websocket) is None:
        await websocket.close(code=4401, reason="unauthorized")
        return
    await websocket.accept()
    hub.start()
    queue = hub.attach()
    await websocket.send_text(json.dumps({"type": "hello", "demo": get_settings().DEMO, "server_ts": now_iso()}))

    async def sender() -> None:
        while True:
            payload = await queue.get()
            if payload == "__slow__":
                await websocket.close(code=1013, reason="slow consumer")
                return
            await websocket.send_text(payload)

    send_task = asyncio.create_task(sender())
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                message: dict[str, Any] = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if message.get("type") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
            # anything else is ignored per contract
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001
        log.debug("ws closed", extra={"fields": {"error": type(exc).__name__}})
    finally:
        hub.detach(queue)
        send_task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await send_task
