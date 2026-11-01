from __future__ import annotations

import pytest

from azzy.orchestrator.bounds import BoundExceeded, CollaborationLedger
from azzy.orchestrator.planner import WORKFLOW_STEPS, build_plan, steps_total_for
from azzy.policy import CollaborationBounds, get_policy


def ledger(**overrides: int) -> CollaborationLedger:
    base = get_policy().collaboration
    values = {f: getattr(base, f) for f in CollaborationBounds.__dataclass_fields__}
    values.update(overrides)
    return CollaborationLedger(CollaborationBounds(**values))


def test_depth_bound() -> None:
    led = ledger()
    assert led.enter_delegation() == 1
    assert led.enter_delegation() == 2
    assert led.enter_delegation() == 3
    with pytest.raises(BoundExceeded) as exc:
        led.enter_delegation()
    assert exc.value.bound == "max_delegation_depth"
    assert led.leave_delegation() == 2
    assert led.enter_delegation() == 3


def test_message_bound() -> None:
    led = ledger(max_messages_per_task=5)
    for _ in range(5):
        led.record_message()
    with pytest.raises(BoundExceeded) as exc:
        led.record_message()
    assert "more than 5" in str(exc.value)


def test_retry_bound_per_step() -> None:
    led = ledger()
    assert led.record_retry("emir:sandbox.run") == 1
    assert led.record_retry("emir:sandbox.run") == 2
    with pytest.raises(BoundExceeded):
        led.record_retry("emir:sandbox.run")
    assert led.record_retry("cyber:trivy.scan") == 1  # independent step


def test_timeouts_and_cancel() -> None:
    led = ledger(task_timeout_seconds=0)
    led.started_at -= 1
    with pytest.raises(BoundExceeded) as exc:
        led.check_task_timeout()
    assert exc.value.bound == "task_timeout_seconds"
    assert ledger().step_timeout() == 300.0
    cancelled = ledger()
    cancelled.cancelled = True
    with pytest.raises(BoundExceeded):
        cancelled.check_cancelled()


def test_workflow_script_fits_the_bounds() -> None:
    """The scripted workflow (6 orchestrator messages, depth ≤ 3) must never trip its own limits."""
    led = ledger()
    for _agent, to, msg_type, _content in WORKFLOW_STEPS:
        if msg_type in {"handoff", "request"}:
            led.enter_delegation()
        led.record_message()
        if msg_type == "result":
            led.leave_delegation()
        assert led.depth <= 3
    assert led.messages == len(WORKFLOW_STEPS) == 6
    pairs = [(a, b) for a, b, _t, _m in WORKFLOW_STEPS]
    assert ("jimmy", "emir") in pairs and ("emir", "cyber") in pairs and ("cyber", "jimmy") in pairs and ("jimmy", "sara") in pairs


def test_plans() -> None:
    plan = build_plan("workflow", "jimmy", ["jimmy", "emir", "cyber", "sara"])
    assert [s.agent for s in plan.stages] == ["jimmy", "emir", "cyber", "jimmy", "sara", "jimmy"]
    assert steps_total_for(plan) == 6
    command = build_plan("command", "jimmy", ["jimmy", "cyber", "sara"])
    assert [s.name for s in command.stages] == ["work", "review", "qa", "docs"]
    assert command.stages[1].agent == "cyber" and command.stages[-1].agent == "sara"
    assert steps_total_for(command) == 3  # qa is conditional
    assert [s.agent for s in build_plan("chat", "emir", ["emir"]).stages] == ["emir"]
