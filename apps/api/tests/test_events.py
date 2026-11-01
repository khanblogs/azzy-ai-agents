"""Pin the Python event mirror to packages/events/src/index.ts by parsing the TS file."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from azzy import events
from azzy.events import (
    AGENT_META,
    EVENT_TYPES,
    PIPELINE_ORDER,
    RANKS,
    Approval,
    Task,
    event_json,
    new_event,
    parse_event,
    rank_for,
)

TS_FILE = Path(__file__).resolve().parents[3] / "packages" / "events" / "src" / "index.ts"
TS = TS_FILE.read_text(encoding="utf-8")


def ts_enum(name: str) -> list[str]:
    match = re.search(rf"export const {name} = z\.enum\(\[(.*?)\]\)", TS, re.DOTALL)
    assert match, f"{name} not found in index.ts"
    return re.findall(r'"([^"]+)"', match.group(1))


def py_enum(cls: type) -> list[str]:
    return [member.value for member in cls]  # type: ignore[attr-defined]


@pytest.mark.parametrize(
    ("ts_name", "py_cls"),
    [
        ("AgentId", events.AgentId),
        ("AgentPhase", events.AgentPhase),
        ("Spot", events.Spot),
        ("PipelineState", events.PipelineState),
        ("RiskLevel", events.RiskLevel),
        ("ApprovalStatus", events.ApprovalStatus),
        ("IncidentStatus", events.IncidentStatus),
        ("OfficeStatus", events.OfficeStatus),
        ("UserRole", events.UserRole),
        ("AwsScope", events.AwsScope),
        ("AccountStatus", events.AccountStatus),
        ("DeploymentStatus", events.DeploymentStatus),
        ("AgentMessageType", events.AgentMessageType),
        ("TaskKind", events.TaskKind),
    ],
)
def test_enum_literals_match(ts_name: str, py_cls: type) -> None:
    assert py_enum(py_cls) == ts_enum(ts_name)


def test_event_types_match_ts_literals() -> None:
    ts_types = re.findall(r'type: z\.literal\("([a-z._]+)"\)', TS)
    assert sorted(ts_types) == sorted(EVENT_TYPES)
    assert len(ts_types) == 19


def test_inline_enums_match() -> None:
    assert re.search(r'source: z\.enum\(\["cloudwatch", "manual", "agent"\]\)', TS)
    assert re.search(r'severity: z\.enum\(\["sev1", "sev2", "sev3"\]\)', TS)
    assert re.search(r'kind: z\.enum\(\["fact", "lesson", "skill_proposal"\]\)', TS)
    assert re.search(r'health: z\.enum\(\["healthy", "degraded", "down", "unknown"\]\)', TS)
    assert re.search(r'role: z\.enum\(\["user", "agent", "system"\]\)', TS)
    assert re.search(r'status: z\.enum\(\["sent", "acknowledged", "completed", "failed"\]\)', TS)
    assert re.search(r'stage: z\.enum\(\["dev", "uat", "staging", "prod"\]\)', TS)
    assert [k.value for k in events.TaskKind] == ["command", "incident", "routine", "meeting", "chat", "workflow"]


def test_pipeline_order_and_ranks_match() -> None:
    ts_order = re.search(r"PIPELINE_ORDER: PipelineState\[\] = \[(.*?)\]", TS, re.DOTALL)
    assert ts_order and re.findall(r'"([^"]+)"', ts_order.group(1)) == [s.value for s in PIPELINE_ORDER]
    ts_ranks = re.findall(r'\{ name: "([A-Za-z]+)", min: (\d+) \}', TS)
    assert [(n, int(m)) for n, m in ts_ranks] == list(RANKS)
    assert rank_for(0) == "Intern" and rank_for(120) == "Associate" and rank_for(3000) == "Fellow"


def test_agent_meta_matches() -> None:
    assert list(AGENT_META) == ["jimmy", "emir", "cyber", "sara", "marwah"]
    assert "john" not in TS
    for agent, meta in AGENT_META.items():
        pattern = (
            rf'{agent}: \{{ name: "{re.escape(meta["name"])}", role: "{re.escape(meta["role"])}", short: "{re.escape(meta["short"])}", '
            rf'color: "{meta["color"]}", domainRole: "{meta["domainRole"]}" \}}'
        )
        assert re.search(pattern, TS), f"AGENT_META mismatch for {agent}"


def test_product_constants_and_brand_match() -> None:
    assert f'PRODUCT_NAME = "{events.PRODUCT_NAME}"' in TS
    assert f'PRODUCT_VERSION = "{events.PRODUCT_VERSION}"' in TS
    assert f'CREATOR_CREDIT = "{events.CREATOR_CREDIT}"' in TS
    for key, value in events.BRAND.items():
        assert re.search(rf'{key}: "{value}"', TS), key


def test_new_event_fills_id_and_ts_and_roundtrips() -> None:
    ev = new_event("agent.say", agent="jimmy", text="hi")
    data = json.loads(event_json(ev))
    assert data["type"] == "agent.say" and data["ttl_ms"] == 6000
    assert len(data["id"]) == 36 and data["ts"].endswith("Z")
    parsed = parse_event(data)
    assert parsed is not None and parsed.type == "agent.say"


def test_new_event_rejects_unknown_type_and_bad_agent() -> None:
    with pytest.raises(ValueError):
        new_event("agent.dance", agent="jimmy")
    with pytest.raises(ValueError):
        new_event("agent.move", agent="azzy", to="desk")
    with pytest.raises(ValueError):
        new_event("agent.move", agent="john", to="desk")
    with pytest.raises(ValueError):
        new_event("agent.move", agent="jimmy", to="pod")  # renamed to table in v2


def test_new_v2_event_shapes() -> None:
    message = events.AgentMessage(id="m", task_id="t", from_agent="jimmy", to_agent="emir", type="handoff", content="x", status="sent", created_at="c")
    assert json.loads(event_json(new_event("agent.message", message=message)))["message"]["artifacts"] == []
    chat = events.ChatMessage(id="c", agent="cyber", conversation_id="v", role="agent", content="hi", task_id=None, created_at="c")
    assert new_event("chat.message", message=chat).message.streaming is False
    account = events.AwsAccount(id="a", name="n", account_id="111122223333", role_arn="arn", has_external_id=False, scope="readonly", regions=[], stage="dev", status="pending", last_verified=None, error=None, created_at="c")
    assert new_event("account.changed", account=account).account.demo is False
    entry = events.AuditEntry(id="e", ts="t", actor="owner", action="auth.login", target=None, task_id=None, ip=None)
    assert new_event("audit.appended", entry=entry).entry.detail == {}


def test_approval_and_task_shapes() -> None:
    approval = Approval(
        id="a1", task_id="t1", agent="jimmy", tool="ssh.safe_action", risk="high", summary="deploy v2.3",
        args={"action": "deploy"}, env_id="client-b-vps", status="pending", created_at="x", decided_at=None,
        decided_by=None, expires_at="y",
    )
    assert set(approval.model_dump()) == {
        "id", "task_id", "agent", "tool", "risk", "summary", "args", "env_id", "status", "created_at",
        "decided_at", "decided_by", "expires_at",
    }
    task = Task(
        id="t1", title="t", prompt="p", state="needs_work", assignees=["jimmy"], lead="jimmy", env_id=None,
        kind="command", created_by="owner@x", created_at="x", updated_at="x", result=None,
    )
    assert task.xp_awarded == 0 and task.steps_total == 0 and task.steps_done == 0
    ev = new_event("task.updated", task=task)
    assert json.loads(event_json(ev))["task"]["state"] == "needs_work"
