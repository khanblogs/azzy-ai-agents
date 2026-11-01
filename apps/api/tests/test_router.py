from __future__ import annotations

from azzy.orchestrator.router import detect_env, detect_version, has_hinglish_verb, is_action_request, route

WORKFLOW_PROMPT = "Investigate my failing ECS deployment, fix the application issue, test it, perform a security assessment, and request approval before deploying"


def test_hinglish_deploy_routes_to_jimmy_on_client_b() -> None:
    r = route("Client B ke VPS pe v2.3 deploy karo")
    assert r.lead == "jimmy" and r.env_id == "client-b-vps" and r.kind == "command" and r.version == "v2.3"
    assert r.assignees[0] == "jimmy" and "cyber" in r.assignees and "sara" in r.assignees


def test_workflow_prompt() -> None:
    r = route(WORKFLOW_PROMPT)
    assert r.kind == "workflow" and r.lead == "jimmy"
    assert set(r.assignees) >= {"jimmy", "emir", "cyber", "sara"}


def test_keyword_routing_per_agent() -> None:
    assert route("rollback client a staging to v2.2.9").lead == "jimmy"
    assert route("check cloudfront and waf logs").lead == "jimmy"
    assert route("review the PR in azzy-ai-agents/client-b-api and fix the flaky test").lead == "emir"
    assert route("train the churn model on the new dataset").lead == "emir"
    assert route("run a nuclei scan and the release gate on staging").lead == "cyber"
    assert route("owasp zap vapt on staging").lead == "cyber"
    assert route("Friday ops KPI report banao").lead == "sara"
    assert route("plan the resource schedule for next quarter").lead == "sara"
    assert route("launch campaign for the new feature with a newsletter").lead == "marwah"
    assert route("seo and brand positioning brief").lead == "marwah"


def test_fallbacks_and_john_is_gone() -> None:
    assert route("please have a look at src/app.py and the json schema").lead == "emir"
    assert route("hello there, what's up").lead == "sara"
    for prompt in ("deploy", "review", "scan", "campaign", "kpi"):
        assert "john" not in route(prompt).assignees


def test_meeting_and_incident_kinds() -> None:
    m = route("call a team meeting about the roadmap")
    assert m.kind == "meeting" and len(m.assignees) == 5
    i = route("incident: client b is down with 5xx")
    assert i.kind == "incident" and i.lead == "jimmy" and i.env_id == "client-b-vps"
    assert i.assignees == ["jimmy", "emir", "cyber", "sara"]


def test_env_detection_aliases() -> None:
    assert detect_env("deploy on prod") == "client-b-vps"
    assert detect_env("check hq") == "hq"
    assert detect_env("nothing here") is None
    assert detect_env("Client-A deploy") == "client-a-staging"


def test_version_and_hinglish() -> None:
    assert detect_version("ship 2.3.1 please") == "v2.3.1"
    assert detect_version("no version") is None
    assert has_hinglish_verb("logs dekho") and has_hinglish_verb("mail bhejo") and not has_hinglish_verb("send the mail")


def test_chat_action_detection() -> None:
    assert is_action_request("deploy v2.4 to client b")
    assert is_action_request("scan karo staging")
    assert is_action_request("can you please run the tests?")
    assert not is_action_request("What environments do we have?")
    assert not is_action_request("how was the last deployment?")


def test_title_is_trimmed() -> None:
    assert len(route("x" * 200).title) <= 72
