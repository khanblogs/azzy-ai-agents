"""Bounded execution for agent collaboration (CONTRACT-v2 §5). Pure (stdlib only).

The worker keeps one `CollaborationLedger` per task and calls it before every delegation,
message and retry. Exceeding a bound raises `BoundExceeded` with a human-readable reason that
becomes the task's `result`.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from azzy.policy import CollaborationBounds


class BoundExceeded(RuntimeError):
    def __init__(self, bound: str, detail: str) -> None:
        super().__init__(f"{bound}: {detail}")
        self.bound = bound
        self.detail = detail


@dataclass(slots=True)
class CollaborationLedger:
    bounds: CollaborationBounds
    started_at: float = field(default_factory=time.monotonic)
    messages: int = 0
    depth: int = 0
    retries: dict[str, int] = field(default_factory=dict)
    cancelled: bool = False

    # ---- delegation depth -----------------------------------------------------------------

    def enter_delegation(self) -> int:
        """Called when an agent hands work to another agent. Returns the new depth."""
        if self.depth + 1 > self.bounds.max_delegation_depth:
            raise BoundExceeded("max_delegation_depth", f"delegation depth would exceed {self.bounds.max_delegation_depth}")
        self.depth += 1
        return self.depth

    def leave_delegation(self) -> int:
        self.depth = max(0, self.depth - 1)
        return self.depth

    # ---- messages --------------------------------------------------------------------------

    def record_message(self) -> int:
        if self.messages + 1 > self.bounds.max_messages_per_task:
            raise BoundExceeded("max_messages_per_task", f"more than {self.bounds.max_messages_per_task} agent messages in one task")
        self.messages += 1
        return self.messages

    # ---- retries ---------------------------------------------------------------------------

    def record_retry(self, step: str) -> int:
        count = self.retries.get(step, 0) + 1
        if count > self.bounds.max_retries_per_step:
            raise BoundExceeded("max_retries_per_step", f"step {step!r} failed more than {self.bounds.max_retries_per_step} times")
        self.retries[step] = count
        return count

    # ---- time ------------------------------------------------------------------------------

    def elapsed(self) -> float:
        return time.monotonic() - self.started_at

    def check_task_timeout(self) -> None:
        if self.elapsed() > self.bounds.task_timeout_seconds:
            raise BoundExceeded("task_timeout_seconds", f"task ran longer than {self.bounds.task_timeout_seconds}s")

    def step_timeout(self) -> float:
        return float(self.bounds.step_timeout_seconds)

    # ---- cancellation ----------------------------------------------------------------------

    def check_cancelled(self) -> None:
        if self.cancelled:
            raise BoundExceeded("cancelled", "cancelled by user")
