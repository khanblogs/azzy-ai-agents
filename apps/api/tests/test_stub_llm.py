from __future__ import annotations

import asyncio
from typing import Any

from azzy.llm import StubLLM, context_message
from azzy.tools.demo_data import ALL_TOOLS, demo_latency_ms, demo_output

CLIENT_B = {"id": "client-b-vps", "name": "Client B — VPS", "kind": "prod", "method": "tailscale_ssh", "target": "100.101.102.103"}


def drive(llm: StubLLM, agent: str, ctx: dict[str, Any], tools: list[str] | None = None) -> list[Any]:
    """Run the stub to completion the way the runner does: append a tool message per call."""
    messages: list[dict[str, Any]] = [context_message(**ctx)]
    tool_specs = [{"name": t} for t in tools] if tools is not None else []
    results = []

    async def go() -> None:
        for _ in range(20):
            result = await llm.complete(agent, messages, tool_specs, task_id=ctx.get("task_id"))
            results.append(result)
            if result.finished:
                return
            for call in result.tool_calls:
                messages.append({"role": "assistant", "content": result.text})
                messages.append({"role": "tool", "name": call.name, "content": demo_output(call.name, call.args, "t")})

    asyncio.run(go())
    return results


def test_deploy_scenario_on_client_b_is_scripted() -> None:
    ctx = {"task_id": "t-deploy", "kind": "command", "stage": "work", "prompt": "Client B ke VPS pe v2.3 deploy karo", "env": CLIENT_B}
    results = drive(StubLLM(), "jimmy", ctx)
    tools = [c.name for r in results for c in r.tool_calls]
    actions = [c.args.get("action") for r in results for c in r.tool_calls if c.name == "ssh.safe_action"]
    assert tools == ["env.registry", "ssh.safe_action", "ssh.safe_action", "ssh.safe_action", "slack.post"]
    assert actions == ["status", "deploy", "status"]
    deploy = [c for r in results for c in r.tool_calls if c.args.get("action") == "deploy"][0]
    assert deploy.args["version"] == "v2.3.0"
    assert results[-1].finished and "v2.3.0" in results[-1].text
    assert all(r.usage.input_tokens > 0 and r.usage.output_tokens > 0 for r in results)


def test_stub_is_deterministic() -> None:
    ctx = {"task_id": "same", "kind": "command", "stage": "work", "prompt": "deploy v2.3 to client b", "env": CLIENT_B}
    a = drive(StubLLM(), "jimmy", ctx)
    b = drive(StubLLM(), "jimmy", ctx)
    assert [(r.text, r.usage.input_tokens) for r in a] == [(r.text, r.usage.input_tokens) for r in b]


def test_tools_filter_restricts_calls() -> None:
    ctx = {"task_id": "t", "kind": "command", "stage": "work", "prompt": "deploy v2.3 to client b", "env": CLIENT_B}
    results = drive(StubLLM(), "jimmy", ctx, tools=["env.registry", "ssh.safe_action"])
    tools = {c.name for r in results for c in r.tool_calls}
    assert tools == {"env.registry", "ssh.safe_action"}


def test_meeting_lines_per_agent() -> None:
    for agent in ("jimmy", "emir", "cyber", "sara", "marwah"):
        results = drive(StubLLM(), agent, {"task_id": "m", "kind": "meeting", "stage": "work", "prompt": "meeting"})
        assert len(results) == 1 and results[0].finished and results[0].text


def test_incident_scripts() -> None:
    ctx = {"task_id": "inc", "kind": "incident", "stage": "work", "prompt": "5xx on client b", "env": CLIENT_B}
    jimmy = [c.name for r in drive(StubLLM(), "jimmy", ctx) for c in r.tool_calls]
    assert jimmy == ["cloudwatch.logs", "aws.describe", "agent.message", "aws.rollback", "aws.describe"]
    emir = [c.name for r in drive(StubLLM(), "emir", ctx) for c in r.tool_calls]
    assert emir == ["github.read", "sandbox.run", "agent.message"]
    cyber = [c.name for r in drive(StubLLM(), "cyber", ctx) for c in r.tool_calls]
    assert cyber == ["cloudwatch.logs", "semgrep.scan", "agent.message"]
    sara = [c.name for r in drive(StubLLM(), "sara", ctx) for c in r.tool_calls]
    assert sara == ["knowledge.search", "gmail.draft"]  # never gmail.send


def test_workflow_steps_are_scripted() -> None:
    env = {"id": "client-a-staging", "name": "Client A — staging", "kind": "staging", "method": "assume_role", "target": "arn"}
    expected = {
        0: ("jimmy", ["aws.describe", "cloudwatch.logs"]),
        1: ("emir", ["github.read", "sandbox.run", "github.branch_pr"]),
        2: ("cyber", ["semgrep.scan", "trivy.scan"]),
        3: ("jimmy", ["aws.deploy", "aws.describe"]),
        4: ("sara", ["pdf.export"]),
        5: ("jimmy", ["ssh.safe_action", "ssh.safe_action"]),
    }
    for step, (agent, tools) in expected.items():
        ctx = {"task_id": "wf", "kind": "workflow", "stage": "workflow", "workflow_step": step, "prompt": "Investigate my failing ECS deployment…", "env": env}
        results = drive(StubLLM(), agent, ctx)
        assert [c.name for r in results for c in r.tool_calls] == tools, step
        assert results[-1].finished
    prod_deploy = [c for r in drive(StubLLM(), "jimmy", {"task_id": "wf", "kind": "workflow", "stage": "workflow", "workflow_step": 5, "prompt": "x", "env": env}) for c in r.tool_calls][0]
    assert prod_deploy.args["env_id"] == "client-b-vps" and prod_deploy.args["version"] == "v2.3.2"


def test_chat_answers_quote_live_state() -> None:
    live = {
        "environments": [{"id": "client-a-staging", "kind": "staging", "health": "healthy", "version": "v2.3.1"}, {"id": "client-b-vps", "kind": "prod", "health": "healthy", "version": "v2.2.9"}],
        "accounts": [{"name": "Demo Dev", "account_id": "111122223333", "scope": "readonly", "status": "verified"}],
        "tasks": {"active": 2, "done": 7, "failed": 0}, "approvals_pending": 1, "incidents_open": 0, "today_usd": 0.42,
        "last_deployment": {"version": "v2.3.0", "env_id": "client-b-vps", "status": "succeeded"},
        "last_scan": {"tool": "semgrep.scan", "target": "azzy-ai-agents/client-a-api", "ok": True, "when": "now"},
    }
    def ask(agent, text):
        return drive(StubLLM(), agent, {"task_id": "c", "kind": "chat", "stage": "chat", "prompt": text, "live": live})[-1].text
    jimmy = ask("jimmy", "What environments do we have?")
    assert "client-b-vps" in jimmy and "client-a-staging" in jimmy and "Demo Dev" in jimmy
    assert "v2.3.0" in ask("jimmy", "how was the last deployment?")
    assert "semgrep" in ask("cyber", "what did the last scan find?")
    assert "2 active" in ask("sara", "status?") and "7 done" in ask("sara", "status?")
    assert "signups" in ask("marwah", "how is growth?").lower()
    assert ask("emir", "any open PRs?")


def test_demo_data_covers_every_tool() -> None:
    for tool in ALL_TOOLS:
        out = demo_output(tool, {}, "seed-1")
        assert isinstance(out, str) and out
        assert demo_output(tool, {}, "seed-1") == out  # deterministic
        assert demo_latency_ms(tool, "seed-1") > 0


def test_demo_data_variation_and_protections() -> None:
    assert demo_output("aws.cost", {"days": 7}, "a") != demo_output("aws.cost", {"days": 7}, "b")
    assert "refusing" in demo_output("github.branch_pr", {"base": "main"}, "x")
    assert "AzzyReadOnlyRole" in demo_output("aws.accounts", {}, "x")
    assert '"route53"' in demo_output("aws.inventory", {"account_id": "444455556666"}, "x")
    assert "zap" in demo_output("zap.scan", {"target": "https://staging.client-a.example.com"}, "x")
    assert "v2.3.0" in demo_output("ssh.safe_action", {"action": "deploy", "version": "v2.3"}, "x")
    assert "rejected" in demo_output("ssh.safe_action", {"action": "reboot"}, "x")
