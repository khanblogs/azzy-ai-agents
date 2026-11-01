from __future__ import annotations

from azzy.policy import get_policy
from azzy.rbac import (
    ROLES,
    Principal,
    admin_only,
    can_cancel_task,
    can_create_task,
    can_decide_approval,
    can_delete_user,
    can_view_scope,
    can_write,
    can_write_knowledge,
    csrf_ok,
    visible_scopes,
)

ADMIN = Principal("owner@azzy.local", "admin")
DEVOPS = Principal("ops@x.io", "devops")
READONLY = Principal("ro@x.io", "readonly")
MARKETING = Principal("mk@x.io", "marketing")


def test_roles() -> None:
    assert ROLES == ("admin", "devops", "developer", "security", "operations", "marketing", "readonly")


def test_readonly_is_get_only() -> None:
    assert not can_write("readonly") and not can_create_task("readonly")
    for role in ("admin", "devops", "developer", "security", "operations", "marketing"):
        assert can_create_task(role)
    assert not can_write("bogus")


def test_cancel_rules() -> None:
    assert can_cancel_task(ADMIN, created_by="someone@x.io", lead_agent="marwah")
    assert can_cancel_task(READONLY, created_by="ro@x.io", lead_agent="jimmy")  # creator
    assert can_cancel_task(DEVOPS, created_by="other@x.io", lead_agent="jimmy")  # domain role
    assert not can_cancel_task(DEVOPS, created_by="other@x.io", lead_agent="marwah")
    assert not can_cancel_task(MARKETING, created_by=None, lead_agent="cyber")


def test_approval_roles_from_policy() -> None:
    roles = get_policy().approval_roles
    assert can_decide_approval("admin", "jimmy", roles)
    assert can_decide_approval("devops", "jimmy", roles)
    assert can_decide_approval("devops", "emir", roles)
    assert not can_decide_approval("marketing", "jimmy", roles)
    assert not can_decide_approval("developer", "cyber", roles)
    assert can_decide_approval("security", "cyber", roles)
    assert not can_decide_approval("readonly", "sara", roles)


def test_admin_only_and_knowledge() -> None:
    assert admin_only("admin") and not admin_only("devops")
    assert can_write_knowledge("devops", "global")
    assert not can_write_knowledge("devops", "client-b-vps")
    assert can_write_knowledge("admin", "client-b-vps")
    assert not can_write_knowledge("readonly", "global")


def test_scope_visibility() -> None:
    env_roles = {"client-a-staging": ["devops", "developer"], "client-b-vps": ["devops"]}
    assert can_view_scope("marketing", "global")
    assert can_view_scope("admin", "client-b-vps")
    assert can_view_scope("devops", "client-b-vps", env_roles["client-b-vps"])
    assert not can_view_scope("developer", "client-b-vps", env_roles["client-b-vps"])
    assert visible_scopes("developer", env_roles=env_roles) == {"global", "client-a-staging"}
    assert visible_scopes("admin", env_roles=env_roles) == {"global", "client-a-staging", "client-b-vps"}
    assert visible_scopes("marketing", task_scopes={"hq"}, env_roles=env_roles) == {"global", "hq"}


def test_user_deletion_guards() -> None:
    assert not can_delete_user(DEVOPS, target_email="x@x.io", target_role="readonly", admin_count=2)
    assert not can_delete_user(ADMIN, target_email="owner@azzy.local", target_role="admin", admin_count=2)  # self
    assert not can_delete_user(ADMIN, target_email="other@x.io", target_role="admin", admin_count=1)  # last admin
    assert can_delete_user(ADMIN, target_email="other@x.io", target_role="admin", admin_count=2)
    assert can_delete_user(ADMIN, target_email="ro@x.io", target_role="readonly", admin_count=1)


def test_csrf_rules() -> None:
    assert csrf_ok("GET", "/api/state", {})
    assert not csrf_ok("POST", "/api/tasks", {})
    assert csrf_ok("POST", "/api/tasks", {"X-Requested-With": "azzy"})
    assert csrf_ok("POST", "/api/tasks", {"x-requested-with": "AZZY"})
    assert not csrf_ok("POST", "/api/tasks", {"X-Requested-With": "XMLHttpRequest"})
    assert csrf_ok("POST", "/api/auth/login", {})
    assert csrf_ok("POST", "/api/webhooks/cloudwatch", {})
    assert csrf_ok("POST", "/api/contact", {})
    assert csrf_ok("POST", "/healthz", {})
    assert not csrf_ok("DELETE", "/api/users/1", {})
