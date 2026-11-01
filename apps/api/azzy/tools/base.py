"""Tool specification and execution context shared by every tool implementation."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from azzy.events import RiskLevel


class ToolError(Exception):
    """Raised by a tool when the call cannot be performed (bad args, not configured, refused)."""


class NotConfigured(ToolError):
    """Real-mode tool whose integration is not configured (missing credentials / binary)."""

    def __init__(self, what: str, hint: str = "") -> None:
        message = f"{what} is not configured"
        if hint:
            message += f" ({hint})"
        super().__init__(message)


@dataclass(slots=True)
class ToolContext:
    """What a tool may know about the call. No secrets live here; tools read env themselves."""

    agent_id: str
    task_id: str | None
    env: dict[str, Any] | None  # row from the environments table (dict form), if any
    demo: bool
    settings: Any  # azzy.config.Settings (typed loosely so pure tests can pass a stub)
    db_session_factory: Callable[[], Any] | None = None
    extra: dict[str, Any] = field(default_factory=dict)


ToolFn = Callable[[ToolContext, dict[str, Any]], Awaitable[str]]


@dataclass(frozen=True, slots=True)
class ToolSpec:
    name: str
    description: str
    risk_hint: RiskLevel
    parameters: dict[str, Any]  # JSON schema for args
    run: ToolFn
    demo_passthrough: bool = False  # True → in DEMO the real implementation runs (office, memory, env.registry)

    def llm_schema(self) -> dict[str, Any]:
        return {"name": self.name, "description": self.description, "parameters": self.parameters}


def schema(properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {"type": "object", "properties": properties, "required": required or [], "additionalProperties": True}


def str_prop(description: str, enum: list[str] | None = None) -> dict[str, Any]:
    prop: dict[str, Any] = {"type": "string", "description": description}
    if enum:
        prop["enum"] = enum
    return prop


def int_prop(description: str) -> dict[str, Any]:
    return {"type": "integer", "description": description}
