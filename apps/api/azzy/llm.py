"""LLM gateway.

* `StubLLM` (DEMO=1): deterministic scripted plans, no network. Imports only stdlib + pydantic.
* `LiteLLMGateway` (DEMO=0): litellm with Bedrock primary and Anthropic/OpenAI fallbacks, per-agent
  daily USD cap and per-task token cap. litellm is imported lazily so this module stays importable
  in test environments without it.

Conversation convention used by both implementations: the runner inserts one message
`{"role": "system", "name": "azzy.context", "content": <JSON>}` describing the task
(kind, stage, prompt, env, task_id). The stub keys its script on that; the gateway passes it
through as ordinary system context. The stub picks the next step by counting `role == "tool"`
messages already in the conversation, so the runner never has to track script position.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from pydantic import BaseModel, Field

log = logging.getLogger("azzy.llm")

STUB_MODEL = "stub/azzy-demo"
CONTEXT_NAME = "azzy.context"


class BudgetExceeded(RuntimeError):
    """Raised when an agent's daily USD cap or per-task token cap would be exceeded."""


class ToolCall(BaseModel):
    id: str = ""
    name: str
    args: dict[str, Any] = Field(default_factory=dict)


class Usage(BaseModel):
    model: str
    input_tokens: int = 0
    output_tokens: int = 0


class LLMResult(BaseModel):
    text: str = ""
    tool_calls: list[ToolCall] = Field(default_factory=list)
    usage: Usage
    finished: bool = False


class LLM(Protocol):
    async def complete(
        self,
        agent_id: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        *,
        task_id: str | None = None,
    ) -> LLMResult: ...


@dataclass(frozen=True, slots=True)
class AgentBudget:
    daily_usd: float
    max_tokens_per_task: int
    model: str


# ----------------------------------------------------------------------------------------------
# Context helpers
# ----------------------------------------------------------------------------------------------


def context_message(**ctx: Any) -> dict[str, Any]:
    """Build the structured context message the runner prepends to every conversation."""
    return {"role": "system", "name": CONTEXT_NAME, "content": json.dumps(ctx, default=str, sort_keys=True)}


def read_context(messages: list[dict[str, Any]]) -> dict[str, Any]:
    for message in messages:
        if message.get("role") == "system" and message.get("name") == CONTEXT_NAME:
            try:
                return dict(json.loads(str(message.get("content") or "{}")))
            except json.JSONDecodeError:
                return {}
    return {}


def _seed(*parts: Any) -> int:
    digest = hashlib.sha256("|".join(str(p) for p in parts).encode()).digest()
    return int.from_bytes(digest[:8], "big")


# ----------------------------------------------------------------------------------------------
# Stub (DEMO)
# ----------------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Step:
    say: str
    tool: str | None = None
    args: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class Script:
    steps: tuple[Step, ...]
    final: str


_VERSION_RE = re.compile(r"\bv?(\d+\.\d+(?:\.\d+)?)\b")


def _version_from(prompt: str, default: str = "2.3.0") -> str:
    match = _VERSION_RE.search(prompt or "")
    if not match:
        return "v" + default
    version = match.group(1)
    if version.count(".") == 1:
        version += ".0"
    return "v" + version


def _repo_from(prompt: str, default: str = "azzy-ai-agents/client-b-api") -> str:
    match = re.search(r"\b([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)\b", prompt or "")
    if match and "." not in match.group(1).split("/")[0]:
        return match.group(1)
    return default


def _target_from(prompt: str) -> str | None:
    match = re.search(r"https?://[^\s\"']+", prompt or "")
    return match.group(0) if match else None


class StubLLM:
    """Deterministic scripted planner for DEMO mode."""

    model = STUB_MODEL

    def __init__(self, scenario_resolver: Callable[[dict[str, Any]], Script] | None = None) -> None:
        self._resolver = scenario_resolver or self.script_for

    # ---- public --------------------------------------------------------------------------

    async def complete(
        self,
        agent_id: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        *,
        task_id: str | None = None,
    ) -> LLMResult:
        ctx = read_context(messages)
        ctx.setdefault("agent", agent_id)
        script = self._resolver(ctx)
        allowed = {t.get("name") or t.get("function", {}).get("name") for t in tools} if tools else None
        index = sum(1 for m in messages if m.get("role") == "tool")
        task_key = task_id or ctx.get("task_id") or "demo"
        rng = _seed(task_key, agent_id, index)
        input_tokens = 1_400 + (rng % 900) + index * 350
        output_tokens = 120 + ((rng >> 8) % 160)
        usage = Usage(model=self.model, input_tokens=input_tokens, output_tokens=output_tokens)

        steps = [s for s in script.steps if allowed is None or s.tool is None or s.tool in allowed]
        if index < len(steps):
            step = steps[index]
            calls = [ToolCall(id=f"call_{index}", name=step.tool, args=dict(step.args))] if step.tool else []
            return LLMResult(text=step.say, tool_calls=calls, usage=usage, finished=False)
        return LLMResult(text=script.final, tool_calls=[], usage=usage, finished=True)

    # ---- scripts -------------------------------------------------------------------------

    @staticmethod
    def script_for(ctx: dict[str, Any]) -> Script:
        agent = str(ctx.get("agent", "emir"))
        kind = str(ctx.get("kind", "command"))
        stage = str(ctx.get("stage", "work"))
        prompt = str(ctx.get("prompt", ""))
        env = ctx.get("env") or {}
        env_id = env.get("id") if isinstance(env, dict) else None
        env_kind = env.get("kind") if isinstance(env, dict) else None
        env_method = env.get("method") if isinstance(env, dict) else None
        env_target = (env.get("target") if isinstance(env, dict) else None) or "100.101.102.103"
        env_name = (env.get("name") if isinstance(env, dict) else None) or (env_id or "the environment")

        if kind == "meeting":
            return _meeting_script(agent, prompt)
        if kind == "chat":
            return _chat_script(agent, prompt, ctx.get("live") or {})
        if kind == "workflow":
            return _workflow_script(agent, int(ctx.get("workflow_step", 0)), env_id, env_name, prompt)
        if kind == "incident":
            return _incident_script(agent, env_id, env_name, prompt)
        if stage == "review":
            return _review_script(agent, prompt)
        if stage == "qa":
            return _qa_script(prompt)
        if stage == "docs":
            return Script(steps=(), final=_docs_summary(prompt, env_name))
        if kind == "routine":
            return _routine_script(agent, str(ctx.get("routine_id", "")), prompt)
        return _command_script(agent, prompt, env_id, env_kind, env_method, env_target, env_name)


def _lower(prompt: str) -> str:
    return (prompt or "").lower()


def _command_script(
    agent: str, prompt: str, env_id: str | None, env_kind: str | None, env_method: str | None, target: str, env_name: str
) -> Script:
    text = _lower(prompt)
    if agent == "jimmy":
        return _jimmy_command(prompt, text, env_id, env_method, target, env_name)
    if agent == "emir":
        return _emir_command(prompt, text)
    if agent == "cyber":
        return _cyber_command(prompt, text)
    if agent == "marwah":
        return _marwah_command(prompt, text)
    return _sara_command(prompt, text)


def _jimmy_command(prompt: str, text: str, env_id: str | None, env_method: str | None, target: str, env_name: str) -> Script:
    version = _version_from(prompt)
    is_rollback = "rollback" in text or "roll back" in text
    is_deploy = "deploy" in text or is_rollback
    env_id = env_id or "client-a-staging"
    if is_deploy and env_method == "tailscale_ssh":
        action = "rollback" if is_rollback else "deploy"
        return Script(
            steps=(
                Step(f"Looking up {env_name} in the environment registry.", "env.registry", {"env_id": env_id}),
                Step("Checking current service status over Tailscale SSH.", "ssh.safe_action", {"env_id": env_id, "host": target, "action": "status"}),
                Step(f"Requesting {action} of {version} on {env_name} (prod).", "ssh.safe_action", {"env_id": env_id, "host": target, "action": action, "version": version}),
                Step("Verifying health after the change.", "ssh.safe_action", {"env_id": env_id, "host": target, "action": "status"}),
                Step("Posting the result to #deploys.", "slack.post", {"channel": "#deploys", "text": f"{env_name}: {action} {version} complete, health OK"}),
            ),
            final=f"{action.capitalize()} of {version} on {env_name} complete. Service healthy, p95 latency nominal, no error spike in the first 60 s.",
        )
    if is_deploy:
        action = "aws.rollback" if is_rollback else "aws.deploy"
        return Script(
            steps=(
                Step(f"Looking up {env_name} in the environment registry.", "env.registry", {"env_id": env_id}),
                Step("Describing the ECS service before the change.", "aws.describe", {"env_id": env_id, "service": "ecs", "cluster": "app"}),
                Step(f"{'Rolling back' if is_rollback else 'Deploying'} {version} via ECS service update.", action, {"env_id": env_id, "service": "api", "version": version}),
                Step("Watching the rollout until the deployment is steady.", "aws.describe", {"env_id": env_id, "service": "ecs", "cluster": "app"}),
                Step("Posting the result to #deploys.", "slack.post", {"channel": "#deploys", "text": f"{env_name}: {version} rolled out, tasks healthy"}),
            ),
            final=f"{version} is live on {env_name}: 2/2 ECS tasks healthy, target group passing, no 5xx after rollout.",
        )
    if "inventory" in text or "account" in text:
        return Script(
            steps=(
                Step("Listing the verified AWS accounts.", "aws.accounts", {}),
                Step("Pulling the resource inventory.", "aws.inventory", {"account_id": "111122223333", "region": "ap-south-1"}),
            ),
            final="Inventory collected: 2 verified accounts; demo-dev ap-south-1 has 3 ECS services, 1 RDS instance and 3 buckets, all healthy.",
        )
    if "cost" in text:
        return Script(
            steps=(
                Step("Pulling the registered environments.", "env.registry", {}),
                Step("Fetching Cost Explorer data for the last 7 days.", "aws.cost", {"env_id": env_id, "days": 7}),
                Step("Sharing the cost summary in #ops.", "slack.post", {"channel": "#ops", "text": "7-day cost summary posted by Jimmy"}),
            ),
            final="7-day cost is tracking 4% under last week; the only riser is NAT gateway data transfer on Client A staging.",
        )
    if "log" in text or "restart" in text:
        action = "restart" if "restart" in text else "logs"
        if env_method == "tailscale_ssh":
            return Script(
                steps=(
                    Step(f"Looking up {env_name}.", "env.registry", {"env_id": env_id}),
                    Step(f"Running `{action}` on the VPS.", "ssh.safe_action", {"env_id": env_id, "host": target, "action": action}),
                    Step("Confirming status.", "ssh.safe_action", {"env_id": env_id, "host": target, "action": "status"}),
                ),
                final=f"{action.capitalize()} done on {env_name}; service is up and responding.",
            )
        return Script(
            steps=(
                Step(f"Looking up {env_name}.", "env.registry", {"env_id": env_id}),
                Step("Tailing CloudWatch logs for the api service.", "cloudwatch.logs", {"env_id": env_id, "log_group": "/ecs/api", "minutes": 30}),
                Step("Describing the service.", "aws.describe", {"env_id": env_id, "service": "ecs", "cluster": "app"}),
            ),
            final=f"Logs on {env_name} look clean: no errors in the last 30 minutes, service steady.",
        )
    return Script(
        steps=(
            Step("Pulling the environment registry.", "env.registry", {}),
            Step("Describing the running services.", "aws.describe", {"env_id": env_id, "service": "ecs", "cluster": "app"}),
            Step("Checking recent logs for anomalies.", "cloudwatch.logs", {"env_id": env_id, "log_group": "/ecs/api", "minutes": 60}),
        ),
        final=f"Infra check on {env_name} complete: all services healthy, nothing needs action.",
    )


def _emir_command(prompt: str, text: str) -> Script:
    repo = _repo_from(prompt)
    wants_change = any(k in text for k in ("fix", "refactor", "implement", "add ", "patch", "karo"))
    if any(k in text for k in ("sql", "query", "data", "dataset", "analys", "analyz", "model", "train")):
        return Script(
            steps=(
                Step("Checking the knowledge base for the analysis conventions.", "knowledge.search", {"q": "analysis notebook conventions"}),
                Step("Running a read-only query against the analytics replica.", "sql.read", {"dsn": "analytics-ro", "query": "SELECT date_trunc('day', created_at) d, count(*) FROM orders WHERE created_at > now() - interval '14 days' GROUP BY 1 ORDER BY 1"}),
                Step("Reproducing the analysis in the sandbox.", "sandbox.run", {"image": "python:3.12-slim", "cmd": "python analysis.py", "files": {"analysis.py": "import pandas as pd; print('ok')"}}),
            ),
            final="Analysis done: 14-day orders are flat (+1.8%), with a Saturday dip explained by the payment-provider maintenance window. Notebook-as-script attached.",
        )
    steps: list[Step] = [
        Step(f"Reading the relevant files in {repo}.", "github.read", {"repo": repo, "path": "src/", "ref": "main"}),
        Step("Running the test suite in the network-less sandbox.", "sandbox.run", {"image": "python:3.12-slim", "cmd": "pytest -q"}),
    ]
    if wants_change:
        steps.append(Step("Opening a branch + PR with the fix and a regression test.", "github.branch_pr", {"repo": repo, "base": "develop", "branch": "fix/azzy-emir", "title": f"fix: {prompt[:60]}"}))
        steps.append(Step("Handing the security-relevant change to Cyber.", "agent.message", {"to": "cyber", "type": "request", "content": f"PR opened on {repo} (fix + regression test). Please run SAST before merge."}))
        final = f"Fix pushed on a branch in {repo} with a regression test; PR opened against develop. Cyber notified for the security pass."
    else:
        final = f"Review of {repo} done: 2 suggestions (error handling in the retry path, a flaky time-based test). No blockers."
    return Script(steps=tuple(steps), final=final)


def _cyber_command(prompt: str, text: str) -> Script:
    repo = _repo_from(prompt, default="azzy-ai-agents/client-a-api")
    target = _target_from(prompt)
    if "iam" in text or "posture" in text or "account" in text:
        return Script(
            steps=(
                Step("Reviewing IAM on the verified accounts.", "iam.review", {"account_id": "111122223333"}),
                Step("Checking config rules and public exposure.", "aws.describe", {"service": "ec2"}),
            ),
            final="IAM review: 1 high (legacy-ci access key > 180 days — rotate), 1 medium (wildcard s3:*). MFA enforced, no root keys.",
        )
    steps = [
        Step("Pulling the release-gate runbook.", "knowledge.search", {"q": "release gate criteria"}),
        Step(f"Running SAST on {repo}.", "semgrep.scan", {"repo": repo, "ruleset": "p/owasp-top-ten"}),
        Step("Sweeping the history for secrets.", "gitleaks.scan", {"repo": repo}),
        Step("Scanning images and dependencies.", "trivy.scan", {"image": f"{repo.split('/')[-1]}:latest"}),
    ]
    if "iac" in text or "terraform" in text or "checkov" in text:
        steps.append(Step("Scanning IaC with checkov.", "checkov.scan", {"path": "infra/terraform"}))
    if target or "nuclei" in text or "pentest" in text or "vapt" in text or "dynamic" in text:
        steps.append(Step("Dynamic scan against the authorised staging target.", "nuclei.scan", {"target": target or "https://staging.client-a.example.com", "severity": "medium,high,critical"}))
    if "zap" in text or "owasp" in text or "dast" in text or "vapt" in text:
        steps.append(Step("OWASP ZAP baseline against the authorised target.", "zap.scan", {"target": target or "https://staging.client-a.example.com", "mode": "baseline"}))
    if "e2e" in text or "playwright" in text or "release" in text or "gate" in text:
        steps.append(Step("Running the Playwright E2E suite.", "playwright.run", {"suite": "e2e", "base_url": target or "https://staging.client-a.example.com"}))
    return Script(
        steps=tuple(steps),
        final="Release gate: PASS with 1 medium (outdated jinja2 in the api image — bump to 3.1.4). No secrets, no critical findings.",
    )


def _sara_command(prompt: str, text: str) -> Script:
    title = prompt.strip()[:60] or "Operations update"
    if any(k in text for k in ("deck", "pptx", "slides", "presentation", "kpi")):
        return Script(
            steps=(
                Step("Pulling the week's KPIs.", "sql.read", {"dsn": "analytics-ro", "query": "SELECT metric, value FROM weekly_kpis WHERE week = date_trunc('week', now())"}),
                Step("Building the deck.", "pptx.build", {"title": title, "slides": ["KPIs", "Deploys", "Incidents", "Next week"]}),
                Step("Drafting the cover email.", "gmail.draft", {"to": "client@example.com", "subject": f"{title} — weekly update", "body": "Hi team, please find this week's operations review attached."}),
            ),
            final="KPI deck built (4 slides) and cover email drafted; nothing has been sent — awaiting your go-ahead.",
        )
    if any(k in text for k in ("excel", "xlsx", "spreadsheet", "budget", "model", "resource")):
        return Script(
            steps=(
                Step("Gathering cost inputs.", "aws.cost", {"days": 30}),
                Step("Building the Excel model with live formulas.", "xlsx.model", {"title": title, "sheets": ["Assumptions", "Budget", "Summary"]}),
            ),
            final="Budget model ready: assumptions sheet drives the 12-month budget with SUM/IF formulas; totals reconcile to AWS actuals.",
        )
    if "pdf" in text or "report" in text or "summary" in text:
        return Script(
            steps=(
                Step("Collecting the figures.", "sql.read", {"dsn": "analytics-ro", "query": "SELECT * FROM monthly_summary ORDER BY month DESC LIMIT 1"}),
                Step("Exporting the PDF.", "pdf.export", {"title": title, "sections": ["Summary", "Metrics", "Risks", "Next steps"]}),
            ),
            final="PDF report exported with sourced figures; ready for review.",
        )
    if "ticket" in text or "zendesk" in text:
        return Script(
            steps=(Step("Drafting the customer-visible ticket update.", "zendesk.update", {"ticket_id": "4821", "status": "pending", "comment": "Thanks for your patience — the fix is scheduled for tonight's deploy."}),),
            final="Ticket update prepared; it goes out only once approved.",
        )
    if any(k in text for k in ("calendar", "schedule", "meeting", "invite")):
        return Script(
            steps=(Step("Creating the calendar event.", "gcal.schedule", {"title": title, "when": "tomorrow 11:00", "attendees": ["owner"]}),),
            final="Calendar invite prepared for tomorrow 11:00; will be created once approved.",
        )
    steps = [Step("Drafting the email.", "gmail.draft", {"to": "client@example.com", "subject": title, "body": "Hi, sharing a short update from the AZZY AI AGENTS team."})]
    if "send" in text or "bhejo" in text or "bhej do" in text:
        steps.append(Step("Requesting approval to send.", "gmail.send", {"draft": "latest", "to": "client@example.com"}))
        final = "Email sent to the client after approval; copy filed in Sent."
    else:
        final = "Email drafted and saved to Drafts — nothing sent. Say the word and I'll request approval to send."
    return Script(steps=tuple(steps), final=final)


def _marwah_command(prompt: str, text: str) -> Script:
    title = prompt.strip()[:60] or "Campaign"
    if any(k in text for k in ("campaign", "launch", "ads", "social", "newsletter", "post")):
        steps = [
            Step("Checking brand guidelines in the knowledge base.", "knowledge.search", {"q": "brand voice guidelines"}),
            Step("Pulling last campaign performance.", "sql.read", {"dsn": "analytics-ro", "query": "SELECT channel, spend, clicks, conversions FROM campaign_perf WHERE week >= now() - interval '28 days'"}),
            Step("Building the campaign plan deck.", "pptx.build", {"title": title, "slides": ["Objective", "Audience", "Channel mix", "Budget", "Timeline"]}),
            Step("Drafting the launch newsletter for approval.", "gmail.draft", {"to": "subscribers@example.com", "subject": f"{title} — launch", "body": "Introducing the next release of AZZY AI AGENTS."}),
        ]
        if "send" in text or "publish" in text or "bhejo" in text:
            steps.append(Step("Requesting approval to send the newsletter.", "gmail.send", {"draft": "latest", "to": "subscribers@example.com"}))
        return Script(steps=tuple(steps), final="Campaign plan ready: 5-slide deck, 3-channel mix inside the ₹1.2L budget, launch newsletter drafted (not sent).")
    if any(k in text for k in ("growth", "report", "analytics", "engagement", "kpi")):
        return Script(
            steps=(
                Step("Pulling channel metrics.", "sql.read", {"dsn": "analytics-ro", "query": "SELECT channel, sessions, signups FROM growth_weekly ORDER BY week DESC LIMIT 8"}),
                Step("Building the growth report.", "pptx.build", {"title": title, "slides": ["Highlights", "Channel mix", "Engagement", "Spend vs plan"]}),
                Step("Exporting the one-page PDF summary.", "pdf.export", {"title": title + " — summary", "sections": ["Highlights", "Next week"]}),
            ),
            final="Growth report built: signups +12% WoW, organic now 41% of sessions, spend 6% under plan. PDF summary attached.",
        )
    return Script(
        steps=(
            Step("Checking positioning notes.", "knowledge.search", {"q": "product positioning"}),
            Step("Drafting the content piece.", "gmail.draft", {"to": "marketing@example.com", "subject": title, "body": "Draft copy for review."}),
        ),
        final="Draft content ready for review in Drafts; on-brand voice, two headline options, sources cited.",
    )


def _review_script(agent: str, prompt: str) -> Script:
    repo = _repo_from(prompt)
    if agent == "cyber":
        return Script(steps=(Step("Reviewing the change for security regressions.", "semgrep.scan", {"repo": repo, "ruleset": "p/ci"}),), final="Review: no security regressions; approve from my side.")
    if agent == "jimmy":
        return Script(steps=(Step("Reviewing the deployment impact.", "aws.describe", {"service": "ecs", "cluster": "app"}),), final="Review: rollout plan is safe; no infra changes needed.")
    if agent in {"sara", "marwah"}:
        return Script(steps=(), final="Review: wording and numbers are consistent with last week's update.")
    return Script(steps=(Step("Reading the diff.", "github.read", {"repo": repo, "path": "src/", "ref": "develop"}),), final="Review: logic is sound, tests cover the change; one nit on naming. Approve.")


def _qa_script(prompt: str) -> Script:
    target = _target_from(prompt) or "https://staging.client-a.example.com"
    return Script(
        steps=(
            Step("Running the smoke E2E suite.", "playwright.run", {"suite": "smoke", "base_url": target}),
            Step("Quick SAST pass on the change.", "semgrep.scan", {"repo": _repo_from(prompt), "ruleset": "p/ci"}),
        ),
        final="QA gate PASS: 12/12 smoke tests green, no new findings.",
    )


def _docs_summary(prompt: str, env_name: str) -> str:
    return f"Summary written: what was asked ({prompt[:50].strip()}…), what was done on {env_name}, outcome and follow-ups."


def _routine_script(agent: str, routine_id: str, prompt: str) -> Script:
    if routine_id == "daily_fleet_report" or agent == "jimmy":
        return Script(
            steps=(
                Step("Collecting health and versions for every environment.", "env.registry", {}),
                Step("Listing verified AWS accounts.", "aws.accounts", {}),
                Step("Pulling the 24 h cost delta.", "aws.cost", {"days": 2}),
                Step("Checking open CloudWatch alarms.", "cloudwatch.logs", {"log_group": "/aws/alarms", "minutes": 1440}),
                Step("Posting the fleet report to #ops.", "slack.post", {"channel": "#ops", "text": "Daily fleet report: all green"}),
            ),
            final="Daily fleet report posted: 3 environments and 2 accounts healthy, cost delta -2.1%, 0 open alarms.",
        )
    if routine_id == "friday_ops_review" or agent == "sara":
        return Script(
            steps=(
                Step("Collecting the week's deploys, incidents and approvals.", "sql.read", {"dsn": "analytics-ro", "query": "SELECT * FROM weekly_summary WHERE week = date_trunc('week', now())"}),
                Step("Building the operations review deck.", "pptx.build", {"title": "Weekly operations review", "slides": ["Deploys", "Incidents", "Approvals", "Cost", "Open tasks"]}),
                Step("Exporting the one-page PDF.", "pdf.export", {"title": "Weekly operations review — summary", "sections": ["Summary", "Risks"]}),
                Step("Drafting the cover email for approval.", "gmail.draft", {"to": "client@example.com", "subject": "Weekly operations review", "body": "Please find this week's review attached."}),
            ),
            final="Friday operations review built (deck + PDF) and cover email drafted — awaiting approval to send.",
        )
    if routine_id == "monday_growth_report" or agent == "marwah":
        return Script(
            steps=(
                Step("Pulling campaign performance.", "sql.read", {"dsn": "analytics-ro", "query": "SELECT channel, spend, conversions FROM campaign_perf WHERE week = date_trunc('week', now() - interval '7 days')"}),
                Step("Building the growth report deck.", "pptx.build", {"title": "Weekly growth report", "slides": ["Performance", "Channel mix", "Engagement", "Spend vs plan"]}),
                Step("Exporting the PDF summary.", "pdf.export", {"title": "Weekly growth report — summary", "sections": ["Highlights", "Actions"]}),
            ),
            final="Monday growth report ready: conversions +9% WoW, paid social CPA down 14%, spend 3% under plan.",
        )
    if routine_id == "knowledge_retention":
        return Script(steps=(), final="Retention sweep complete.")
    return Script(
        steps=(
            Step("Weekly SAST across repos.", "semgrep.scan", {"repo": "azzy-ai-agents/client-a-api", "ruleset": "p/owasp-top-ten"}),
            Step("Secrets sweep.", "gitleaks.scan", {"repo": "azzy-ai-agents/client-a-api"}),
            Step("IaC scan.", "checkov.scan", {"path": "infra/"}),
            Step("Container scan.", "trivy.scan", {"image": "client-a-api:latest"}),
            Step("IAM review of verified accounts.", "iam.review", {"account_id": "111122223333"}),
        ),
        final="Weekly audit: 0 critical, 2 high (both dependency bumps), release gate PASS with conditions.",
    )


def _incident_script(agent: str, env_id: str | None, env_name: str, prompt: str) -> Script:
    env_id = env_id or "client-b-vps"
    if agent == "jimmy":
        return Script(
            steps=(
                Step("Pulling error logs from the last 15 minutes.", "cloudwatch.logs", {"env_id": env_id, "log_group": "/ecs/api", "minutes": 15, "filter": "ERROR"}),
                Step("Describing the service and recent deployments.", "aws.describe", {"env_id": env_id, "service": "ecs", "cluster": "app"}),
                Step("Sharing diagnostics with Emir for root cause.", "agent.message", {"to": "emir", "type": "handoff", "content": "Error rate spiked right after the last deploy; RetryBudgetExceeded in payments. Diagnostics attached."}),
                Step("Error rate correlates with the last deploy — requesting rollback.", "aws.rollback", {"env_id": env_id, "service": "api", "to": "previous"}),
                Step("Confirming health after rollback.", "aws.describe", {"env_id": env_id, "service": "ecs", "cluster": "app"}),
            ),
            final=f"Rolled {env_name} back to the previous task definition; 5xx rate back to 0.1%, latency nominal.",
        )
    if agent == "emir":
        return Script(
            steps=(
                Step("Reading the diff of the last deploy.", "github.read", {"repo": "azzy-ai-agents/client-b-api", "path": "src/payments/retry.py", "ref": "main"}),
                Step("Reproducing the failure in the sandbox.", "sandbox.run", {"image": "python:3.12-slim", "cmd": "pytest -q tests/test_retry.py"}),
                Step("Reporting the root cause to Jimmy.", "agent.message", {"to": "jimmy", "type": "result", "content": "Root cause: unbounded retry loop in payments/retry.py; fix + regression test ready on a branch."}),
            ),
            final="Root cause: unbounded retry loop in payments/retry.py introduced in the last deploy; fix + test ready on a branch.",
        )
    if agent == "cyber":
        return Script(
            steps=(
                Step("Checking for an attack pattern in the access logs.", "cloudwatch.logs", {"env_id": env_id, "log_group": "/nginx/access", "minutes": 30, "filter": "status>=400"}),
                Step("Scanning the diff for injected code.", "semgrep.scan", {"repo": "azzy-ai-agents/client-b-api", "ruleset": "p/ci"}),
                Step("Confirming to Jimmy that this is not an attack.", "agent.message", {"to": "jimmy", "type": "note", "content": "No attack signature: organic traffic, no WAF hits, diff is clean."}),
            ),
            final="No attack signature: traffic is organic, no WAF hits, no secrets or malicious code in the diff.",
        )
    return Script(
        steps=(
            Step("Pulling the incident-comms runbook.", "knowledge.search", {"q": "incident communication template"}),
            Step("Drafting the client incident update.", "gmail.draft", {"to": "client@example.com", "subject": f"Incident update — {env_name}", "body": "We detected elevated errors and have rolled back; service is stable. Full RCA to follow."}),
        ),
        final="Client update drafted (not sent). Will send once you approve after the RCA.",
    )


# ---- workflow (CONTRACT-v2 §5) --------------------------------------------------------------


def _workflow_script(agent: str, step: int, env_id: str | None, env_name: str, prompt: str) -> Script:
    staging = "client-a-staging"
    prod = env_id if env_id and env_id != staging else "client-b-vps"
    repo = "azzy-ai-agents/client-a-api"
    if step == 0:  # jimmy investigates
        return Script(
            steps=(
                Step("Describing the failing ECS service and its recent deployments.", "aws.describe", {"env_id": staging, "service": "ecs", "cluster": "app", "_after_deploy": True}),
                Step("Pulling the ECS task logs around the failures.", "cloudwatch.logs", {"env_id": staging, "log_group": "/ecs/api", "minutes": 15, "filter": "ERROR"}),
            ),
            final="Diagnosis: tasks start, then exit 1 after RetryBudgetExceeded in payments/retry.py — an application bug, not infra. Handing diagnostics to Emir.",
        )
    if step == 1:  # emir fixes
        return Script(
            steps=(
                Step("Reading the retry module Jimmy flagged.", "github.read", {"repo": repo, "path": "src/payments/retry.py", "ref": "main"}),
                Step("Reproducing and fixing in the sandbox, then running the suite.", "sandbox.run", {"image": "python:3.12-slim", "cmd": "pytest -q"}),
                Step("Opening the fix branch and PR against develop.", "github.branch_pr", {"repo": repo, "base": "develop", "branch": "fix/azzy-retry-budget", "title": "fix(payments): bound retry budget + regression test"}),
            ),
            final="Fix ready: bounded retry budget with a regression test (54 passed). PR opened against develop. Over to Cyber for the security pass.",
        )
    if step == 2:  # cyber assesses
        return Script(
            steps=(
                Step("SAST on the fix branch.", "semgrep.scan", {"repo": repo, "ref": "fix/azzy-retry-budget", "ruleset": "p/owasp-top-ten"}),
                Step("Dependency and image scan.", "trivy.scan", {"image": "client-a-api:fix-retry"}),
            ),
            final="Security assessment: 0 critical, 0 high, 1 medium dependency bump noted. Cleared for staging.",
        )
    if step == 3:  # jimmy staging deploy
        return Script(
            steps=(
                Step("Deploying the fix to staging (auto-allowed).", "aws.deploy", {"env_id": staging, "service": "api", "version": "v2.3.2"}),
                Step("Health check after the staging rollout.", "aws.describe", {"env_id": staging, "service": "ecs", "cluster": "app"}),
            ),
            final="Staging deploy of v2.3.2 healthy: 2/2 tasks running, 0 5xx. Asking Sara for the incident summary before production.",
        )
    if step == 4:  # sara summary
        return Script(
            steps=(Step("Exporting the one-minute incident summary for the owner.", "pdf.export", {"title": "Incident summary — failing ECS deployment", "sections": ["What happened", "Root cause", "Fix & evidence", "Production plan"]}),),
            final="Incident summary PDF ready: cause, fix, test evidence and the production plan on one page.",
        )
    return Script(  # step 5: jimmy prod deploy with approval
        steps=(
            Step(f"Requesting approval to deploy v2.3.2 to {prod} (production).", "aws.deploy" if prod != "client-b-vps" else "ssh.safe_action", {"env_id": prod, "service": "api", "version": "v2.3.2", "host": "100.101.102.103", "action": "deploy"}),
            Step("Verifying production health.", "aws.describe" if prod != "client-b-vps" else "ssh.safe_action", {"env_id": prod, "service": "ecs", "cluster": "app", "host": "100.101.102.103", "action": "status"}),
        ),
        final="Production deployment of v2.3.2 complete and verified healthy. All evidence stored; workflow done.",
    )


# ---- chat (CONTRACT-v2 §4) -------------------------------------------------------------------


def _fmt_envs(live: dict[str, Any]) -> str:
    envs = live.get("environments") or []
    if not envs:
        return "no environments are registered yet"
    parts = [f"{e.get('id')} ({e.get('kind')}, {e.get('health', 'unknown')}, {e.get('version') or 'n/a'})" for e in envs]
    return ", ".join(parts)


def _chat_script(agent: str, prompt: str, live: dict[str, Any]) -> Script:
    text = _lower(prompt)
    tasks = live.get("tasks") or {}
    deployment = live.get("last_deployment") or {}
    scan = live.get("last_scan") or {}
    accounts = live.get("accounts") or []
    approvals_pending = int(live.get("approvals_pending") or 0)
    incidents_open = int(live.get("incidents_open") or 0)
    today_usd = float(live.get("today_usd") or 0.0)
    greeting = ""
    if any(w in text for w in ("hello", "hi ", "hey", "namaste")) and len(text) < 40:
        greeting = {"jimmy": "Hey. Jimmy here — fleet's green and I'm watching the deploy queue. ", "emir": "Hi! Emir here, ready to dig into code. ", "cyber": "Cyber here. Scopes loaded, scanners warm. ", "sara": "Hello! Sara from operations. ", "marwah": "Hi there! Marwah, marketing. "}[agent]
    if agent == "jimmy":
        if "environment" in text or "env" in text or "fleet" in text or "what do we have" in text:
            body = f"We have {len(live.get('environments') or [])} environments: {_fmt_envs(live)}."
            if accounts:
                body += f" Verified AWS accounts: {', '.join(a.get('name', a.get('account_id', '')) for a in accounts)}."
        elif "deploy" in text and ("last" in text or "recent" in text or "status" in text):
            body = (f"Last deployment: {deployment.get('version')} to {deployment.get('env_id')} — {deployment.get('status')}." if deployment else "No deployments recorded yet; say the word and I'll plan one.")
        elif "account" in text or "aws" in text:
            acct_list = ", ".join(f"{a.get('name')} ({a.get('account_id')}, {a.get('scope')}, {a.get('status')})" for a in accounts)
            body = (f"AWS accounts on file: {acct_list}." if accounts else "No AWS accounts onboarded yet — add one under AWS Accounts and I'll verify the role.")
        elif "cost" in text or "spend" in text:
            body = f"LLM spend today is ${today_usd:.2f}; infra cost is tracking under last week. I can pull Cost Explorer for a specific account if you name it."
        elif "incident" in text:
            body = f"{incidents_open} incident(s) open right now." + (" I'm on it with Emir and Cyber." if incidents_open else " Fleet is quiet.")
        else:
            body = f"Fleet status: {_fmt_envs(live)}. {approvals_pending} approval(s) waiting on you. Ask me about environments, deployments, accounts or costs."
    elif agent == "emir":
        if "pr" in text or "review" in text or "code" in text:
            body = "Open PRs: fix/azzy-retry-budget (bounded retries + regression test) is waiting for review; the flaky time-based test is quarantined. Point me at a repo and I'll review it."
        elif "test" in text:
            body = "Last sandbox run: 54 passed, 0 failed, 3.9 s. Tests run only in the network-less sandbox."
        else:
            body = f"I'm tracking {tasks.get('active', 0)} active task(s). I can review code, debug a failure, write a fix with a test, or analyse data. What are we looking at?"
    elif agent == "cyber":
        if scan:
            body = f"Last scan: {scan.get('tool')} on {scan.get('target') or 'the repo'} — {'passed' if scan.get('ok') else 'had findings'} ({scan.get('when')}). Release gate: PASS with 1 medium open (jinja2 bump)."
        else:
            body = "No scans recorded yet. Authorised targets are limited to AUTHORIZED_TARGETS and verified AWS accounts; name one and I'll start with SAST + secrets."
        if "iam" in text or "posture" in text:
            body += " IAM posture: MFA enforced, no root keys, one legacy access key to rotate."
    elif agent == "sara":
        body = (
            f"Operations snapshot: {tasks.get('active', 0)} active, {tasks.get('done', 0)} done, {tasks.get('failed', 0)} failed; "
            f"{approvals_pending} approval(s) pending, {incidents_open} incident(s) open, ${today_usd:.2f} spent today."
        )
        if "report" in text or "kpi" in text:
            body += " I can build the KPI deck or a one-page PDF — say which."
    else:
        body = "Growth this week: signups +12% WoW, organic 41% of sessions, spend 6% under plan. Want a campaign plan, a growth report, or copy for a launch?"
        if "brand" in text or "positioning" in text:
            body = "Positioning: 'AZZY AI AGENTS — your AI operations team that asks before it acts.' Brand voice is confident, concrete, numbers-first."
    return Script(steps=(), final=(greeting + body).strip())


_MEETING_LINES: dict[str, str] = {
    "jimmy": "Fleet is green. Client B is on v2.2.9; v2.3 is staged and ready whenever you approve.",
    "emir": "One PR in review, one flaky test quarantined. Payments retry fix ships with a regression test.",
    "cyber": "Weekly audit: zero critical findings. Release gate passes once the jinja2 bump lands.",
    "sara": "Ops review deck is drafted; client email waits for approval. Budget model reconciles to AWS.",
    "marwah": "Launch campaign plan is ready; newsletter drafted, signups +12% week over week.",
}


def _meeting_script(agent: str, prompt: str) -> Script:
    return Script(steps=(), final=_MEETING_LINES.get(agent, "Nothing to report."))


# ----------------------------------------------------------------------------------------------
# LiteLLM gateway (real mode)
# ----------------------------------------------------------------------------------------------


def _to_openai_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalise the runner's conversation into OpenAI-style messages litellm accepts everywhere."""
    out: list[dict[str, Any]] = []
    for message in messages:
        role = message.get("role")
        if role == "system":
            out.append({"role": "system", "content": str(message.get("content", ""))})
        elif role == "assistant":
            entry: dict[str, Any] = {"role": "assistant", "content": message.get("content") or ""}
            calls = message.get("tool_calls") or []
            if calls:
                entry["tool_calls"] = [
                    {"id": c.get("id") or f"call_{i}", "type": "function", "function": {"name": c["name"], "arguments": json.dumps(c.get("args") or {}, default=str)}}
                    for i, c in enumerate(calls)
                ]
            out.append(entry)
        elif role == "tool":
            out.append({"role": "tool", "tool_call_id": message.get("tool_call_id") or "call_0", "name": message.get("name", ""), "content": str(message.get("content", ""))})
        else:
            out.append({"role": "user", "content": str(message.get("content", ""))})
    return out


class LiteLLMGateway:
    """Bedrock-first gateway with key-gated fallbacks and budget enforcement.

    `spent_today(agent_id)` returns the agent's USD spend so far today (from the costs table).
    Secrets are read from the environment by litellm itself and never logged here.
    """

    def __init__(
        self,
        budgets: dict[str, AgentBudget],
        spent_today: Callable[[str], Any],
        *,
        region: str = "ap-south-1",
        default_model: str | None = None,
    ) -> None:
        self._budgets = budgets
        self._spent_today = spent_today
        self._region = region
        self._default_model = default_model
        self._task_tokens: dict[str, int] = {}

    def _fallbacks(self) -> list[str]:
        models: list[str] = []
        if os.environ.get("ANTHROPIC_API_KEY"):
            models.append("anthropic/claude-3-5-sonnet-20241022")
        if os.environ.get("OPENAI_API_KEY"):
            models.append("openai/gpt-4o")
        return models

    def _check_budget(self, agent_id: str, task_id: str | None) -> AgentBudget:
        budget = self._budgets.get(agent_id) or AgentBudget(5.0, 60_000, self._default_model or "")
        spent = float(self._spent_today(agent_id) or 0.0)
        if spent >= budget.daily_usd:
            raise BudgetExceeded(f"{agent_id} has spent ${spent:.2f} of a ${budget.daily_usd:.2f} daily cap")
        if task_id and self._task_tokens.get(task_id, 0) >= budget.max_tokens_per_task:
            raise BudgetExceeded(f"task {task_id} exceeded {budget.max_tokens_per_task} tokens for {agent_id}")
        return budget

    async def complete(
        self,
        agent_id: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        *,
        task_id: str | None = None,
    ) -> LLMResult:
        import litellm  # imported lazily: not needed in DEMO / tests

        budget = self._check_budget(agent_id, task_id)
        model = budget.model or self._default_model or "bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0"
        chain = [model, *self._fallbacks()]
        cleaned = _to_openai_messages(messages)
        tool_specs = [
            {"type": "function", "function": {"name": t["name"], "description": t.get("description", ""), "parameters": t.get("parameters", {"type": "object", "properties": {}})}}
            for t in tools
        ]
        last_error: Exception | None = None
        for candidate in chain:
            try:
                kwargs: dict[str, Any] = {
                    "model": candidate,
                    "messages": cleaned,
                    "max_tokens": 1024,
                    "temperature": 0.2,
                    "timeout": 90,
                }
                if tool_specs:
                    kwargs["tools"] = tool_specs
                    kwargs["tool_choice"] = "auto"
                if candidate.startswith("bedrock/"):
                    kwargs["aws_region_name"] = self._region
                response = await litellm.acompletion(**kwargs)
                return self._parse(response, candidate, task_id)
            except Exception as exc:  # noqa: BLE001 - we fall through the chain, then raise the last error
                last_error = exc
                log.warning(json.dumps({"event": "llm.fallback", "agent": agent_id, "model": candidate, "error": type(exc).__name__}))
                continue
        raise RuntimeError(f"all models failed for {agent_id}: {type(last_error).__name__ if last_error else 'unknown'}")

    def _parse(self, response: Any, model: str, task_id: str | None) -> LLMResult:
        choice = response.choices[0]
        message = choice.message
        calls: list[ToolCall] = []
        for raw in getattr(message, "tool_calls", None) or []:
            function = raw.function
            try:
                args = json.loads(function.arguments or "{}")
            except json.JSONDecodeError:
                args = {"_raw": function.arguments}
            calls.append(ToolCall(id=raw.id or "", name=function.name, args=args if isinstance(args, dict) else {"value": args}))
        usage_obj = getattr(response, "usage", None)
        input_tokens = int(getattr(usage_obj, "prompt_tokens", 0) or 0)
        output_tokens = int(getattr(usage_obj, "completion_tokens", 0) or 0)
        if task_id:
            self._task_tokens[task_id] = self._task_tokens.get(task_id, 0) + input_tokens + output_tokens
        text = message.content if isinstance(message.content, str) else ""
        return LLMResult(
            text=text or "",
            tool_calls=calls,
            usage=Usage(model=model, input_tokens=input_tokens, output_tokens=output_tokens),
            finished=not calls,
        )

    def forget_task(self, task_id: str) -> None:
        self._task_tokens.pop(task_id, None)
