"""Integration status + tests (CONTRACT-v2 §9). Derived from env + binary presence; secrets never returned."""

from __future__ import annotations

import os
import shutil
from typing import Any

import httpx

from azzy.config import Settings

_CATALOG: tuple[tuple[str, str, str], ...] = (
    ("github", "GitHub", "scm"), ("gitlab", "GitLab", "scm"), ("jenkins", "Jenkins", "ci"), ("slack", "Slack", "comms"),
    ("gmail", "Gmail", "comms"), ("gcal", "Google Calendar", "comms"), ("zendesk", "Zendesk", "support"),
    ("bedrock", "Amazon Bedrock", "llm"), ("anthropic", "Anthropic", "llm"), ("openai", "OpenAI", "llm"),
    ("tailscale", "Tailscale", "connectivity"), ("ssm", "AWS Systems Manager", "connectivity"),
    ("semgrep", "Semgrep", "scanner"), ("gitleaks", "Gitleaks", "scanner"), ("trivy", "Trivy", "scanner"),
    ("checkov", "Checkov", "scanner"), ("nuclei", "Nuclei", "scanner"), ("zap", "OWASP ZAP", "scanner"),
    ("playwright", "Playwright", "testing"),
)


def _configured(integration_id: str, settings: Settings) -> tuple[bool, str]:
    env = os.environ
    match integration_id:
        case "github":
            return bool(env.get("GITHUB_TOKEN")), "GITHUB_TOKEN"
        case "gitlab":
            return bool(env.get("GITLAB_TOKEN")), "GITLAB_TOKEN (read-only pipeline inspection)"
        case "jenkins":
            return bool(env.get("JENKINS_URL") and env.get("JENKINS_TOKEN")), "JENKINS_URL + JENKINS_TOKEN"
        case "slack":
            return bool(settings.SLACK_WEBHOOK_URL), "SLACK_WEBHOOK_URL"
        case "gmail" | "gcal":
            return bool(env.get("GMAIL_CREDENTIALS_JSON")), "GMAIL_CREDENTIALS_JSON"
        case "zendesk":
            return bool(env.get("ZENDESK_SUBDOMAIN") and env.get("ZENDESK_API_TOKEN")), "ZENDESK_SUBDOMAIN + ZENDESK_EMAIL + ZENDESK_API_TOKEN"
        case "bedrock":
            return not settings.DEMO, f"instance role · {settings.BEDROCK_MODEL}"
        case "anthropic":
            return bool(env.get("ANTHROPIC_API_KEY")), "ANTHROPIC_API_KEY (fallback)"
        case "openai":
            return bool(env.get("OPENAI_API_KEY")), "OPENAI_API_KEY (fallback)"
        case "tailscale":
            return bool(shutil.which("ssh")), "ssh client + tag:servers ACL"
        case "ssm":
            return bool(env.get("AWS_REGION")), "instance role · ssm:SendCommand"
        case "zap":
            return bool(shutil.which("zap-baseline.py") or shutil.which("zap.sh")), "zap-baseline.py"
        case "playwright":
            return bool(shutil.which("npx")), "node + e2e/"
        case _:
            return bool(shutil.which(integration_id)), f"{integration_id} binary"


def list_integrations(settings: Settings) -> list[dict[str, Any]]:
    out = []
    for integration_id, name, category in _CATALOG:
        configured, detail = _configured(integration_id, settings)
        out.append({"id": integration_id, "name": name, "category": category, "configured": configured, "demo": settings.DEMO, "detail": detail})
    return out


async def test_integration(integration_id: str, settings: Settings) -> dict[str, Any]:
    ids = {i for i, _, _ in _CATALOG}
    if integration_id not in ids:
        raise KeyError(integration_id)
    configured, detail = _configured(integration_id, settings)
    if settings.DEMO:
        return {"ok": True, "demo": True, "detail": f"simulated: {integration_id} responds OK in DEMO ({detail})"}
    if not configured:
        return {"ok": False, "demo": False, "detail": f"not configured: {detail}"}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            if integration_id == "github":
                resp = await client.get("https://api.github.com/user", headers={"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}", "User-Agent": "azzy-ai-agents"})
                return {"ok": resp.status_code == 200, "demo": False, "detail": f"GitHub API HTTP {resp.status_code}"}
            if integration_id == "slack":
                resp = await client.post(str(settings.SLACK_WEBHOOK_URL), json={"text": "AZZY AI AGENTS integration test"})
                return {"ok": resp.status_code == 200, "demo": False, "detail": f"webhook HTTP {resp.status_code}"}
            if integration_id in {"anthropic", "openai"}:
                url = "https://api.anthropic.com/v1/models" if integration_id == "anthropic" else "https://api.openai.com/v1/models"
                headers = {"x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01"} if integration_id == "anthropic" else {"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"}
                resp = await client.get(url, headers=headers)
                return {"ok": resp.status_code == 200, "demo": False, "detail": f"HTTP {resp.status_code}"}
    except httpx.HTTPError as exc:
        return {"ok": False, "demo": False, "detail": f"network error: {type(exc).__name__}"}
    if integration_id == "bedrock":
        try:
            import boto3  # noqa: PLC0415

            boto3.client("bedrock", region_name=settings.AWS_REGION).list_foundation_models(byProvider="anthropic")
            return {"ok": True, "demo": False, "detail": "bedrock:ListFoundationModels OK"}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "demo": False, "detail": f"{type(exc).__name__}"}
    binary = shutil.which(integration_id) or shutil.which({"zap": "zap-baseline.py", "playwright": "npx", "tailscale": "ssh"}.get(integration_id, integration_id))
    return {"ok": bool(binary), "demo": False, "detail": f"binary {'found at ' + binary if binary else 'missing'}"}
