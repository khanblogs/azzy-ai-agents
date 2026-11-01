"""Audit trail writer (CONTRACT-v2 §9): persist an AuditEntry and emit `audit.appended`.

`tool.call` entries are persisted but not emitted (they already stream as `tool.log`).
"""

from __future__ import annotations

import logging
from typing import Any

from azzy.db import repo
from azzy.db.engine import session_scope
from azzy.events import AuditAppendedEvent

log = logging.getLogger("azzy.audit")

SILENT_ACTIONS: frozenset[str] = frozenset({"tool.call"})


async def record(
    bus: Any,
    *,
    actor: str,
    action: str,
    target: str | None = None,
    task_id: str | None = None,
    detail: dict[str, Any] | None = None,
    ip: str | None = None,
    session: Any | None = None,
) -> None:
    """Best effort: an audit failure is logged, never raised into the request/agent path."""
    safe_detail = {k: v for k, v in (detail or {}).items() if not _looks_secret(k)}
    try:
        if session is not None:
            row = await repo.add_audit(session, actor=actor, action=action, target=target, task_id=task_id, detail=safe_detail, ip=ip)
            entry = repo.audit_to_model(row)
        else:
            async with session_scope() as own:
                row = await repo.add_audit(own, actor=actor, action=action, target=target, task_id=task_id, detail=safe_detail, ip=ip)
                entry = repo.audit_to_model(row)
    except Exception as exc:  # noqa: BLE001
        log.warning("audit write failed", extra={"fields": {"action": action, "error": type(exc).__name__}})
        return
    if action not in SILENT_ACTIONS and bus is not None:
        try:
            await bus.publish(AuditAppendedEvent(entry=entry))
        except Exception as exc:  # noqa: BLE001
            log.debug("audit emit failed", extra={"fields": {"error": type(exc).__name__}})


def _looks_secret(key: str) -> bool:
    lowered = key.lower()
    return any(token in lowered for token in ("secret", "password", "token", "otp", "external_id", "authorization"))
