"""Role-based access control (CONTRACT-v2 §3). Pure module (stdlib only), used by API deps.

Roles: admin, devops, developer, security, operations, marketing, readonly.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass

ROLES: tuple[str, ...] = ("admin", "devops", "developer", "security", "operations", "marketing", "readonly")
ADMIN = "admin"
READONLY = "readonly"

# agent id → the user role that "owns" that agent's domain (mirrors AGENT_META.domainRole).
AGENT_DOMAIN_ROLE: dict[str, str] = {
    "jimmy": "devops",
    "emir": "developer",
    "cyber": "security",
    "sara": "operations",
    "marwah": "marketing",
}

# Paths (under /api) that never need the CSRF header.
CSRF_EXEMPT_PREFIXES: tuple[str, ...] = ("/api/auth/login", "/api/webhooks/", "/api/contact")
CSRF_HEADER = "x-requested-with"
CSRF_VALUE = "azzy"


class Forbidden(Exception):
    """Raised by checks; the API maps it to 403 {detail}."""


@dataclass(frozen=True, slots=True)
class Principal:
    email: str
    role: str

    @property
    def is_admin(self) -> bool:
        return self.role == ADMIN

    @property
    def is_readonly(self) -> bool:
        return self.role == READONLY


def is_valid_role(role: str) -> bool:
    return role in ROLES


def can_write(role: str) -> bool:
    """readonly users may only perform GET requests."""
    return role in ROLES and role != READONLY


def can_create_task(role: str) -> bool:
    """create tasks / chat / call meeting / simulate incident: any role except readonly."""
    return can_write(role)


def can_cancel_task(principal: Principal, *, created_by: str | None, lead_agent: str | None) -> bool:
    """creator, admin, or the lead agent's domain role."""
    if principal.is_admin:
        return True
    if created_by and created_by.lower() == principal.email.lower():
        return True
    if lead_agent and AGENT_DOMAIN_ROLE.get(lead_agent) == principal.role:
        return True
    return False


def can_decide_approval(role: str, agent: str, approval_roles: Mapping[str, Iterable[str]]) -> bool:
    """admin, or a role listed in policy.yaml approval_roles[agent]."""
    if role == ADMIN:
        return True
    return role in tuple(approval_roles.get(agent, ()))


def admin_only(role: str) -> bool:
    """environments / AWS accounts / users / integrations / settings writes."""
    return role == ADMIN


def can_write_knowledge(role: str, scope: str) -> bool:
    """upload/delete: admin for any scope; any non-readonly role for scope 'global'."""
    if role == ADMIN:
        return True
    return can_write(role) and scope == "global"


def can_view_scope(role: str, scope: str, env_allowed_roles: Iterable[str] = ()) -> bool:
    """`global` is visible to everyone; an env/account scope only to admin or the env's allowed roles."""
    if scope == "global" or role == ADMIN:
        return True
    return role in tuple(env_allowed_roles)


def visible_scopes(role: str, *, task_scopes: Iterable[str] = (), env_roles: Mapping[str, Iterable[str]] | None = None) -> set[str]:
    """Scopes a search may read: global + any task scopes + envs whose allowed roles include `role`."""
    scopes = {"global", *task_scopes}
    for scope, roles in (env_roles or {}).items():
        if can_view_scope(role, scope, roles):
            scopes.add(scope)
    return scopes


def csrf_ok(method: str, path: str, headers: Mapping[str, str]) -> bool:
    """Every non-GET /api request (except login/webhooks/contact) must carry X-Requested-With: azzy."""
    if method.upper() in {"GET", "HEAD", "OPTIONS"}:
        return True
    if not path.startswith("/api/"):
        return True
    if any(path.startswith(prefix) for prefix in CSRF_EXEMPT_PREFIXES):
        return True
    lowered = {k.lower(): v for k, v in headers.items()}
    return lowered.get(CSRF_HEADER, "").strip().lower() == CSRF_VALUE


def can_delete_user(actor: Principal, *, target_email: str, target_role: str, admin_count: int) -> bool:
    """Admins may delete users except themselves and the last admin."""
    if not actor.is_admin:
        return False
    if target_email.lower() == actor.email.lower():
        return False
    if target_role == ADMIN and admin_count <= 1:
        return False
    return True


def route_role_for_agent(agent: str) -> str | None:
    return AGENT_DOMAIN_ROLE.get(agent)
