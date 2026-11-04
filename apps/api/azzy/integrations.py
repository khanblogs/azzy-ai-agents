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
    ("omniroute", "OmniRoute", "llm"), ("freellmapi", "FreeLLMAPI", "llm"),
    ("tailscale", "Tailscale", "connectivity"), ("ssm", "AWS Systems Manager", "connectivity"),
    ("semgrep", "Semgrep", "scanner"), ("gitleaks", "Gitleaks", "scanner"), ("trivy", "Trivy", "scanner"),
    ("checkov", "Checkov", "scanner"), ("nuclei", "Nuclei", "scanner"), ("zap", "OWASP ZAP", "scanner"),
    ("playwright", "Playwright", "testing"), ("obscura", "Obscura", "web"),
    ("crawl4ai", "Crawl4AI", "web"), ("healthchecks", "Healthchecks", "monitoring"),
    ("uptime-kuma", "Uptime Kuma", "monitoring"), ("umami", "Umami Analytics", "analytics"),
    ("mem0", "Mem0 Memory", "memory"), ("floci", "Floci (Local AWS)", "testing"),
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
        case "omniroute":
            return bool(env.get("OPENAI_API_BASE")), "OPENAI_API_BASE (OmniRoute fallback gateway)"
        case "freellmapi":
            return bool(env.get("FREELLMAPI_URL")), "FREELLMAPI_URL (free-tier provider pool via OmniRoute)"
        case "obscura":
            return bool(shutil.which("obscura")), "obscura binary (web.fetch / web.scrape / web.screenshot)"
        case "crawl4ai":
            return bool(env.get("CRAWL4AI_URL")), "CRAWL4AI_URL (web.extract engine)"
        case "floci":
            return bool(env.get("FLOCI_URL")), "FLOCI_URL (local AWS emulator sandbox for agent AWS tools)"
        case "healthchecks":
            return bool(env.get("HEALTHCHECKS_URL")), "HEALTHCHECKS_URL (cron/routine watchdog)"
        case "uptime-kuma":
            return bool(env.get("UPTIME_KUMA_URL")), "UPTIME_KUMA_URL (service uptime monitoring)"
        case "umami":
            return bool(env.get("UMAMI_URL")), "UMAMI_URL (privacy-friendly analytics)"
        case "mem0":
            return env.get("MEM0_ENABLED") == "1", "MEM0_ENABLED (long-term agent memory: pgvector + Bedrock)"
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
            if integration_id == "omniroute":
                base = os.environ.get("OPENAI_API_BASE", "").rstrip("/")
                resp = await client.get(f"{base}/models", headers={"Authorization": f"Bearer {os.environ.get('OPENAI_API_KEY', '')}"})
                return {"ok": resp.status_code == 200, "demo": False, "detail": f"OmniRoute /models HTTP {resp.status_code}"}
            if integration_id == "freellmapi":
                base = os.environ.get("FREELLMAPI_URL", "").rstrip("/")
                resp = await client.get(f"{base}/api/ping")
                return {"ok": resp.status_code == 200, "demo": False, "detail": f"FreeLLMAPI /api/ping HTTP {resp.status_code}"}
            if integration_id == "healthchecks":
                base = os.environ.get("HEALTHCHECKS_URL", "").rstrip("/")
                resp = await client.get(f"{base}/hc/accounts/login/", follow_redirects=True)
                return {"ok": resp.status_code == 200, "demo": False, "detail": f"Healthchecks login HTTP {resp.status_code}"}
            if integration_id == "uptime-kuma":
                base = os.environ.get("UPTIME_KUMA_URL", "").rstrip("/")
                resp = await client.get(f"{base}/api/status-page/azzy")
                return {"ok": resp.status_code == 200, "demo": False, "detail": f"Uptime Kuma status-page HTTP {resp.status_code}"}
            if integration_id == "umami":
                base = os.environ.get("UMAMI_URL", "").rstrip("/")
                resp = await client.get(f"{base}/api/heartbeat")
                return {"ok": resp.status_code == 200, "demo": False, "detail": f"Umami heartbeat HTTP {resp.status_code}"}
            if integration_id == "crawl4ai":
                base = os.environ.get("CRAWL4AI_URL", "").rstrip("/")
                token = os.environ.get("CRAWL4AI_API_TOKEN", "")
                resp = await client.get(f"{base}/health", headers={"Authorization": f"Bearer {token}"} if token else {})
                return {"ok": resp.status_code == 200, "demo": False, "detail": f"Crawl4AI /health HTTP {resp.status_code}"}
    except httpx.HTTPError as exc:
        return {"ok": False, "demo": False, "detail": f"network error: {type(exc).__name__}"}
    if integration_id == "mem0":
        try:
            import mem0  # noqa: F401, PLC0415
            import psycopg  # noqa: PLC0415

            from azzy.memory_ext import _pg_config  # noqa: PLC0415

            cfg = _pg_config()
            conninfo = f"host={cfg['host']} port={cfg['port']} dbname={cfg['dbname']} user={cfg['user']} password={cfg['password']}"
            with psycopg.connect(conninfo, connect_timeout=5) as conn, conn.cursor() as cur:
                cur.execute("SELECT count(*) FROM azzy_memories")
                count = cur.fetchone()[0]
            return {"ok": True, "demo": False, "detail": f"mem0 pgvector reachable ({count} memories)"}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "demo": False, "detail": f"{type(exc).__name__}"}
    if integration_id == "floci":
        try:
            import boto3  # noqa: PLC0415

            base = os.environ.get("FLOCI_URL", "http://floci:4566")
            ident = boto3.client("sts", endpoint_url=base, region_name="ap-south-1",
                                 aws_access_key_id="test", aws_secret_access_key="test").get_caller_identity()
            return {"ok": True, "demo": False, "detail": f"Floci STS OK (account {ident.get('Account')})"}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "demo": False, "detail": f"{type(exc).__name__}"}
    if integration_id == "bedrock":
        try:
            import boto3  # noqa: PLC0415

            boto3.client("bedrock", region_name=settings.AWS_REGION).list_foundation_models(byProvider="anthropic")
            return {"ok": True, "demo": False, "detail": "bedrock:ListFoundationModels OK"}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "demo": False, "detail": f"{type(exc).__name__}"}
    binary = shutil.which(integration_id) or shutil.which({"zap": "zap-baseline.py", "playwright": "npx", "tailscale": "ssh"}.get(integration_id, integration_id))
    return {"ok": bool(binary), "demo": False, "detail": f"binary {'found at ' + binary if binary else 'missing'}"}
