"""Policy engine: resolves a tool call to a risk level and decides whether approval is needed.

Pure module (stdlib + pyyaml + pydantic only) so it can be unit-tested without the app.
Resolution order, per packages/agents/policy.yaml:
  1. `high_if` predicates (tool/arg/env overrides) → high
  2. environment auto-allow (medium only) → handled by `needs_approval`
  3. `tool_defaults` → risk
  4. `default`
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from azzy.events import RiskLevel
from azzy.paths import agents_dir

_RISK_ORDER = {RiskLevel.low: 0, RiskLevel.medium: 1, RiskLevel.high: 2}

# ssh.safe_action sub-commands that cannot mutate the target. They are classified `low` so a
# status check before a deploy does not itself trigger an approval (CONTRACT "DEMO mode").
READ_ONLY_SSH_ACTIONS: frozenset[str] = frozenset({"status", "logs", "disk", "top"})


@dataclass(frozen=True, slots=True)
class Env:
    """Minimal environment view the policy needs."""

    id: str
    kind: str  # staging | prod | hq
    auto_allow: tuple[str, ...] = field(default_factory=tuple)

    @property
    def is_prod(self) -> bool:
        return self.kind == "prod"


@dataclass(frozen=True, slots=True)
class HighIfRule:
    tool: str
    arg: str | None = None
    values: tuple[str, ...] = ()
    arg_regex: str | None = None
    when_env: str | None = None

    def matches(self, tool: str, args: dict[str, Any], env: Env | None) -> bool:
        if tool != self.tool:
            return False
        if self.when_env is not None:
            if env is None or env.kind != self.when_env:
                return False
        if self.arg is not None:
            value = args.get(self.arg)
            if value is None:
                return False
            if str(value).lower() not in {v.lower() for v in self.values}:
                return False
        if self.arg_regex is not None:
            pattern = re.compile(self.arg_regex)
            haystack = " ".join(str(v) for v in args.values())
            if not pattern.search(haystack):
                return False
        return True


SCOPE_RANK: dict[str, int] = {"readonly": 0, "audit": 1, "deploy": 2}


@dataclass(frozen=True, slots=True)
class CollaborationBounds:
    max_delegation_depth: int = 3
    max_messages_per_task: int = 60
    max_retries_per_step: int = 2
    step_timeout_seconds: int = 300
    task_timeout_seconds: int = 5400


@dataclass(frozen=True, slots=True)
class Policy:
    default: RiskLevel
    approval_timeout_seconds: int
    tool_defaults: dict[str, RiskLevel]
    high_if: tuple[HighIfRule, ...]
    ssh_allowlist: tuple[str, ...]
    tool_allowlist: tuple[str, ...]
    scope_requirements: dict[str, str] = field(default_factory=dict)
    collaboration: CollaborationBounds = field(default_factory=CollaborationBounds)
    approval_roles: dict[str, tuple[str, ...]] = field(default_factory=dict)

    # ---- queries -------------------------------------------------------------------

    def is_allowed_tool(self, tool: str) -> bool:
        return tool in self.tool_allowlist

    def classify(self, tool: str, args: dict[str, Any] | None, env: Env | None) -> RiskLevel:
        """Risk level for a call. Unknown tools are treated as high (they are rejected anyway)."""
        args = args or {}
        if not self.is_allowed_tool(tool):
            return RiskLevel.high
        for rule in self.high_if:
            if rule.matches(tool, args, env):
                return RiskLevel.high
        if tool == "ssh.safe_action" and str(args.get("action", "")).strip().lower() in READ_ONLY_SSH_ACTIONS:
            return RiskLevel.low
        return self.tool_defaults.get(tool, self.default)

    def needs_approval(self, risk: RiskLevel, tool: str, env: Env | None) -> bool:
        """low → never; medium → unless env auto-allows the tool; high → always."""
        risk = RiskLevel(risk)
        if risk == RiskLevel.low:
            return False
        if risk == RiskLevel.high:
            return True
        if env is not None and tool in env.auto_allow:
            return False
        return True

    def required_scope(self, tool: str) -> str | None:
        """Minimum AWS account scope the tool needs, or None when the tool is account-agnostic."""
        return self.scope_requirements.get(tool)

    def scope_allows(self, tool: str, account_scope: str | None) -> bool:
        """readonly < audit < deploy. Tools without a requirement always pass."""
        needed = self.required_scope(tool)
        if needed is None:
            return True
        if account_scope is None:
            return False
        return SCOPE_RANK.get(str(account_scope), -1) >= SCOPE_RANK[needed]

    def may_decide(self, role: str, agent: str) -> bool:
        """Which user roles may decide an approval raised by `agent` (admin always may)."""
        if role == "admin":
            return True
        return role in self.approval_roles.get(agent, ())

    def validate_ssh_action(self, action: str) -> str:
        """Return the normalised action or raise ValueError when it is not allowlisted."""
        normalised = (action or "").strip().lower()
        if not re.fullmatch(r"[a-z]+", normalised) or normalised not in self.ssh_allowlist:
            raise ValueError(f"ssh action {action!r} is not in the allowlist {list(self.ssh_allowlist)}")
        return normalised


def _risk(value: Any, where: str) -> RiskLevel:
    try:
        return RiskLevel(str(value))
    except ValueError as exc:
        raise ValueError(f"policy.yaml: invalid risk level {value!r} at {where}") from exc


def parse_policy(data: dict[str, Any]) -> Policy:
    rules: list[HighIfRule] = []
    for raw in data.get("high_if", []) or []:
        rules.append(
            HighIfRule(
                tool=str(raw["tool"]),
                arg=raw.get("arg"),
                values=tuple(str(v) for v in raw.get("in", []) or []),
                arg_regex=raw.get("arg_regex"),
                when_env=raw.get("when_env"),
            )
        )
    tool_defaults = {str(k): _risk(v, f"tool_defaults.{k}") for k, v in (data.get("tool_defaults") or {}).items()}
    scope_requirements = {str(k): str(v) for k, v in (data.get("scope_requirements") or {}).items()}
    for tool, scope in scope_requirements.items():
        if scope not in SCOPE_RANK:
            raise ValueError(f"policy.yaml: invalid scope {scope!r} for {tool}")
    collab_raw = data.get("collaboration") or {}
    collaboration = CollaborationBounds(**{k: int(v) for k, v in collab_raw.items() if k in CollaborationBounds.__dataclass_fields__})
    approval_roles = {str(agent): tuple(str(r) for r in roles or []) for agent, roles in (data.get("approval_roles") or {}).items()}
    return Policy(
        default=_risk(data.get("default", "medium"), "default"),
        approval_timeout_seconds=int(data.get("approval_timeout_seconds", 3600)),
        tool_defaults=tool_defaults,
        high_if=tuple(rules),
        ssh_allowlist=tuple(str(a) for a in data.get("ssh_allowlist", []) or []),
        tool_allowlist=tuple(str(t) for t in data.get("tool_allowlist", []) or []),
        scope_requirements=scope_requirements,
        collaboration=collaboration,
        approval_roles=approval_roles,
    )


def load_policy(path: Path | str | None = None) -> Policy:
    file = Path(path) if path else agents_dir() / "policy.yaml"
    with file.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    return parse_policy(data)


@lru_cache(maxsize=1)
def get_policy() -> Policy:
    return load_policy()


# ---- module-level convenience wrappers (use the cached default policy) -----------------


def classify(tool: str, args: dict[str, Any] | None, env: Env | None) -> RiskLevel:
    return get_policy().classify(tool, args, env)


def needs_approval(risk: RiskLevel, tool: str, env: Env | None) -> bool:
    return get_policy().needs_approval(risk, tool, env)


def validate_ssh_action(action: str) -> str:
    return get_policy().validate_ssh_action(action)


def is_allowed_tool(tool: str) -> bool:
    return get_policy().is_allowed_tool(tool)


def scope_allows(tool: str, account_scope: str | None) -> bool:
    return get_policy().scope_allows(tool, account_scope)


def max_risk(*levels: RiskLevel) -> RiskLevel:
    return max(levels, key=lambda lvl: _RISK_ORDER[RiskLevel(lvl)])
