from __future__ import annotations

import pytest

from azzy.events import RiskLevel
from azzy.policy import Env, classify, get_policy, is_allowed_tool, needs_approval, validate_ssh_action

STAGING = Env(id="client-a-staging", kind="staging", auto_allow=("aws.deploy", "aws.rollback", "ssh.safe_action"))
PROD = Env(id="client-b-vps", kind="prod", auto_allow=())
HQ = Env(id="hq", kind="hq", auto_allow=())


def test_policy_loads_allowlists() -> None:
    policy = get_policy()
    assert policy.default == RiskLevel.medium
    assert policy.approval_timeout_seconds == 3600
    assert "ssh.safe_action" in policy.tool_allowlist
    assert policy.ssh_allowlist == ("status", "restart", "logs", "deploy", "rollback", "disk", "top")


def test_tool_defaults() -> None:
    assert classify("env.registry", {}, None) == RiskLevel.low
    assert classify("aws.describe", {"service": "ecs"}, STAGING) == RiskLevel.low
    assert classify("aws.deploy", {}, STAGING) == RiskLevel.medium
    assert classify("gmail.send", {}, None) == RiskLevel.high
    assert classify("zendesk.update", {}, HQ) == RiskLevel.high


def test_unknown_tool_is_high_and_not_allowed() -> None:
    assert not is_allowed_tool("shell.exec")
    assert classify("shell.exec", {}, None) == RiskLevel.high


def test_prod_ssh_deploy_is_high_staging_is_medium() -> None:
    assert classify("ssh.safe_action", {"action": "deploy", "version": "v2.3.0"}, PROD) == RiskLevel.high
    assert classify("ssh.safe_action", {"action": "restart"}, PROD) == RiskLevel.high
    assert classify("ssh.safe_action", {"action": "status"}, PROD) == RiskLevel.low  # read-only
    assert classify("ssh.safe_action", {"action": "logs"}, PROD) == RiskLevel.low
    assert classify("ssh.safe_action", {"action": "deploy"}, STAGING) == RiskLevel.medium
    assert classify("ssh.safe_action", {"action": "restart"}, STAGING) == RiskLevel.medium


def test_prod_aws_deploy_rollback_high() -> None:
    assert classify("aws.deploy", {"version": "v2.3"}, PROD) == RiskLevel.high
    assert classify("aws.rollback", {}, PROD) == RiskLevel.high
    assert classify("aws.rollback", {}, STAGING) == RiskLevel.medium


def test_sql_ddl_is_high() -> None:
    assert classify("sql.read", {"query": "SELECT * FROM users"}, None) == RiskLevel.low
    assert classify("sql.read", {"query": "select 1; DROP TABLE users"}, None) == RiskLevel.high
    assert classify("sql.read", {"query": "DELETE FROM x"}, None) == RiskLevel.high
    assert classify("sql.read", {"query": "select deleted_at from x"}, None) == RiskLevel.low


def test_iam_describe_is_high() -> None:
    assert classify("aws.describe", {"service": "iam"}, STAGING) == RiskLevel.high
    assert classify("aws.describe", {"service": "IAM"}, STAGING) == RiskLevel.high


def test_branch_pr_to_main_is_high() -> None:
    assert classify("github.branch_pr", {"base": "main"}, None) == RiskLevel.high
    assert classify("github.branch_pr", {"base": "develop"}, None) == RiskLevel.medium


def test_needs_approval_matrix() -> None:
    assert needs_approval(RiskLevel.low, "env.registry", PROD) is False
    assert needs_approval(RiskLevel.medium, "aws.deploy", STAGING) is False  # auto-allowed
    assert needs_approval(RiskLevel.medium, "aws.deploy", PROD) is True
    assert needs_approval(RiskLevel.medium, "github.branch_pr", STAGING) is True  # not in auto_allow
    assert needs_approval(RiskLevel.high, "aws.deploy", STAGING) is True  # never auto-allowed
    assert needs_approval(RiskLevel.medium, "aws.deploy", None) is True


def test_demo_deploy_scenario_requires_approval_on_client_b() -> None:
    risk = classify("ssh.safe_action", {"action": "deploy", "version": "v2.3.0"}, PROD)
    assert risk == RiskLevel.high
    assert needs_approval(risk, "ssh.safe_action", PROD)
    status_risk = classify("ssh.safe_action", {"action": "status"}, PROD)
    assert not needs_approval(status_risk, "ssh.safe_action", PROD)


def test_validate_ssh_action() -> None:
    assert validate_ssh_action(" Deploy ") == "deploy"
    for bad in ("rm -rf /", "status; reboot", "shutdown", "", "deploy && id"):
        with pytest.raises(ValueError):
            validate_ssh_action(bad)


def test_v2_policy_sections() -> None:
    policy = get_policy()
    assert policy.collaboration.max_delegation_depth == 3
    assert policy.collaboration.max_messages_per_task == 60
    assert policy.collaboration.max_retries_per_step == 2
    assert policy.collaboration.step_timeout_seconds == 300
    assert policy.approval_roles["jimmy"] == ("admin", "devops")
    assert policy.may_decide("devops", "jimmy") and not policy.may_decide("marketing", "jimmy") and policy.may_decide("admin", "cyber")
    for tool in ("zap.scan", "iam.review", "aws.accounts", "aws.inventory", "knowledge.search", "agent.message"):
        assert policy.is_allowed_tool(tool)
    assert classify("zap.scan", {}, None) == RiskLevel.medium
    assert classify("agent.message", {}, None) == RiskLevel.low


def test_scope_requirements() -> None:
    policy = get_policy()
    assert policy.required_scope("aws.describe") == "readonly"
    assert policy.required_scope("iam.review") == "audit"
    assert policy.required_scope("aws.deploy") == "deploy"
    assert policy.required_scope("slack.post") is None
    assert policy.scope_allows("aws.describe", "readonly")
    assert policy.scope_allows("aws.describe", "deploy")
    assert not policy.scope_allows("iam.review", "readonly")
    assert policy.scope_allows("iam.review", "audit")
    assert not policy.scope_allows("aws.deploy", "audit")
    assert policy.scope_allows("aws.deploy", "deploy")
    assert policy.scope_allows("slack.post", None)
    assert not policy.scope_allows("aws.cost", None)
